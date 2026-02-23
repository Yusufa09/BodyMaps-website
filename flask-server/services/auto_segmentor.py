import os
import uuid
import subprocess
import re
import csv
import shlex
import shutil
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def get_least_used_gpu(default_gpu=None):
    if default_gpu is None:
        try:
            available_gpus_str = os.getenv("AVAILABLE_GPUS", "")
            available_gpus = [int(x) for x in available_gpus_str.split(",") if x.strip().isdigit()]
            if not available_gpus:
                raise ValueError("No available GPUs specified.")

            result = subprocess.check_output(
                ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                universal_newlines=True
            )
            mem_usages = [int(x) for x in result.strip().split("\n")]
            least_used_gpu = min(available_gpus, key=lambda i: mem_usages[i])
            return str(least_used_gpu)
        except Exception as e:
            print("⚠️ Failed to get GPU info, defaulting to 0:", e)
            return "0"
    else:
        return str(default_gpu)


def _resolve_conda_activate_path():
    candidates = [
        os.getenv("CONDA_ACTIVATE_PATH", "").strip(),
        "/home/visitor/miniconda3/etc/profile.d/conda.sh",
        "/home/visitor/anaconda3/etc/profile.d/conda.sh",
        "/opt/conda/etc/profile.d/conda.sh",
        "/opt/anaconda3/etc/profile.d/conda.sh",
    ]
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return ""


def run_auto_segmentation(input_path, session_dir, model):
    """
    Run auto segmentation model using Apptainer inside the given session directory.
    """
    subfolder_name = "ct"

    input_case_dir = os.path.join(session_dir, "inputs")
    outputs_root = os.path.join(session_dir, "outputs")
    input_case_ct_dir = os.path.join(input_case_dir, subfolder_name)
    os.makedirs(input_case_ct_dir, exist_ok=True)
    os.makedirs(outputs_root, exist_ok=True)

    input_filename = os.path.basename(input_path)
    container_input_path = os.path.join(input_case_ct_dir, input_filename)
    shutil.copy2(input_path, container_input_path)

    conda_activate_cmd = ""

    conda_path = _resolve_conda_activate_path()
    epai_env_name = os.getenv("CONDA_ENV_EPAI", "epai")
    suprem_sandbox_path = os.getenv("SUPREM_SANDBOX_PATH", "")
    epai_script_path = os.getenv("EPAI_SCRIPT_PATH", "")

    if model == 'SuPreM':
        container_path = suprem_sandbox_path
        print(input_case_dir, outputs_root)

        apptainer_cmd = [
            "apptainer", "run", "--nv",
            "-B", f"{input_case_dir}:/workspace/inputs",
            "-B", f"{outputs_root}:/workspace/outputs",
            container_path
        ]
    elif model == 'ePAI':
        output_path = _run_epai_inference(
            input_path=input_path,
            session_dir=session_dir,
            conda_path=conda_path,
            epai_env_name=epai_env_name,
            fallback_script_path=epai_script_path,
        )
        if output_path is None:
            print("[ERROR] ePAI inference failed")
            return None
        return output_path
    else:
        print(f"[ERROR] Unknown model: {model}")
        return None

    selected_gpu = get_least_used_gpu()
    apptainer_cmd = ["CUDA_VISIBLE_DEVICES=" + selected_gpu] + apptainer_cmd
    print(apptainer_cmd)
    try:
        print(f"[INFO] Running {model} auto segmentation for file: {input_filename}")
        full_cmd = f"{conda_activate_cmd} {' '.join(apptainer_cmd)}"
        subprocess.run(full_cmd, shell=True, executable="/bin/bash", check=True)
    except subprocess.CalledProcessError as e:
        print(f"[ERROR] {model} inference failed:", e)
        return None

    if model == 'SuPreM':
        output_path = os.path.join(outputs_root, subfolder_name, "segmentations")
        if not os.path.exists(output_path):
            print("[ERROR] Output mask not found at:", output_path)
            return None
    elif model == 'ePAI':
        output_path = os.path.join(outputs_root, subfolder_name, "combined_labels.nii.gz")
        if not os.path.exists(output_path):
            print("[ERROR] Output mask not found at:", output_path)
            return None
        output_path = os.path.join(outputs_root, subfolder_name)

    return output_path


def _normalize_case_id(input_path_or_filename: str) -> str:
    normalized_input = os.path.normpath(input_path_or_filename or "")
    parent_dir = os.path.basename(os.path.dirname(normalized_input))
    leaf_name = os.path.basename(normalized_input)

    if leaf_name.lower() in {"ct.nii", "ct.nii.gz"} and re.match(r"^BDMAP_\d+$", parent_dir):
        return parent_dir

    filename_no_ext = re.sub(r"(\.nii(\.gz)?)$", "", leaf_name, flags=re.IGNORECASE)
    if re.match(r"^BDMAP_\d+$", filename_no_ext):
        return filename_no_ext
    cleaned = re.sub(r"[^A-Za-z0-9_]+", "_", filename_no_ext).strip("_")
    if cleaned:
        return f"CASE_{cleaned}"
    return f"CASE_{uuid.uuid4().hex[:8]}"


def _ensure_output_csv_template(output_csv_path: str, case_id: str):
    header_path = os.getenv("EPAI_OUTPUT_CSV_TEMPLATE", "/home/visitor/inference/output.csv")
    header = None
    if os.path.exists(header_path):
        with open(header_path, "r", newline="") as f:
            reader = csv.reader(f)
            header = next(reader, None)

    if not header:
        header = [
            "bdmap_id", "shape", "spacing", "pancreas_pr", "pancreas_pr_component_count", "pancreas_pr_voxel_size",
            "pancreas_pr_volume_size", "duct_pr", "duct_pr_component_count", "duct_pr_voxel_size", "duct_pr_volume_size",
            "PDAC_pr", "PDAC_pr_component_count", "PDAC_pr_voxel_size", "PDAC_pr_volume_size",
            "PDAC_pr_largest_component_largest_logit", "cyst_pr", "cyst_pr_component_count", "cyst_pr_voxel_size",
            "cyst_pr_volume_size", "cyst_pr_largest_component_largest_logit", "PNET_pr", "PNET_pr_component_count",
            "PNET_pr_voxel_size", "PNET_pr_volume_size", "PNET_pr_largest_component_largest_logit"
        ]

    with open(output_csv_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerow([case_id] + [""] * (len(header) - 1))


def _run_epai_inference(input_path: str, session_dir: str, conda_path: str, epai_env_name: str, fallback_script_path: str):
    case_id = _normalize_case_id(input_path)

    epai_workspace = os.path.join(session_dir, "epai")
    input_dir = os.path.join(epai_workspace, "eval")
    save_dir = os.path.join(epai_workspace, "out")
    os.makedirs(input_dir, exist_ok=True)
    os.makedirs(save_dir, exist_ok=True)

    nnunet_input = os.path.join(input_dir, f"{case_id}_0000.nii.gz")
    if os.path.lexists(nnunet_input):
        os.remove(nnunet_input)
    os.symlink(input_path, nnunet_input)

    input_csv_path = os.path.join(epai_workspace, "input.csv")
    output_csv_path = os.path.join(epai_workspace, "output.csv")
    with open(input_csv_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["BDMAP ID"])
        writer.writerow([case_id])

    _ensure_output_csv_template(output_csv_path, case_id)

    ckpt_path = os.getenv(
        "EPAI_CKPT_PATH",
        "/home/visitor/ePAI/model/qchen76_2025_0421/nnUNetTrainer__nnUNetPlans__3d_fullres",
    )
    nnunet_raw = os.getenv("EPAI_NNUNET_RAW", "/home/visitor/ePAI/nnUNet/raw")
    nnunet_preprocessed = os.getenv("EPAI_NNUNET_PREPROCESSED", "/home/visitor/ePAI/nnUNet/preprocessed")
    nnunet_results = os.getenv("EPAI_NNUNET_RESULTS", "/home/visitor/ePAI/nnUNet/results")

    selected_gpu = get_least_used_gpu()

    if fallback_script_path and os.path.exists(fallback_script_path):
        script_cmd = ["bash", fallback_script_path, session_dir, case_id, input_dir, save_dir, input_csv_path, output_csv_path, ckpt_path]
        run_payload = f"CUDA_VISIBLE_DEVICES={shlex.quote(selected_gpu)} " + " ".join(shlex.quote(x) for x in script_cmd)
    else:
        run_payload = (
            f"export nnUNet_N_proc_DA={shlex.quote(os.getenv('EPAI_N_PROC_DA', '36'))} && "
            f"export nnUNet_raw={shlex.quote(nnunet_raw)} && "
            f"export nnUNet_preprocessed={shlex.quote(nnunet_preprocessed)} && "
            f"export nnUNet_results={shlex.quote(nnunet_results)} && "
            f"CUDA_VISIBLE_DEVICES={shlex.quote(selected_gpu)} "
            f"nnUNetv2_predict_from_modelfolder "
            f"-i {shlex.quote(input_dir)} "
            f"-o {shlex.quote(save_dir)} "
            f"-m {shlex.quote(ckpt_path)} "
            f"-f all "
            f"--input_csv {shlex.quote(input_csv_path)} "
            f"--output_csv {shlex.quote(output_csv_path)} "
            f"--continue_prediction "
            f"--save_probabilities "
            f"-npp {shlex.quote(os.getenv('EPAI_NPP', '3'))} "
            f"-nps {shlex.quote(os.getenv('EPAI_NPS', '3'))} "
            f"-num_parts 1 "
            f"-part_id 0 "
            f"-chk {shlex.quote(os.getenv('EPAI_CHECKPOINT_NAME', 'checkpoint_final.pth'))}"
        )

    if conda_path and os.path.exists(conda_path):
        full_cmd = (
            f"source {shlex.quote(conda_path)} && "
            f"conda activate {shlex.quote(epai_env_name)} && "
            f"{run_payload}"
        )
    else:
        conda_exe = shutil.which("conda")
        if not conda_exe:
            print("[ERROR] Could not find conda. Set CONDA_ACTIVATE_PATH or ensure `conda` is on PATH.")
            return None

        if fallback_script_path and os.path.exists(fallback_script_path):
            script_cmd = ["bash", fallback_script_path, session_dir, case_id, input_dir, save_dir, input_csv_path, output_csv_path, ckpt_path]
            full_cmd = (
                f"CUDA_VISIBLE_DEVICES={shlex.quote(selected_gpu)} "
                f"{shlex.quote(conda_exe)} run -n {shlex.quote(epai_env_name)} "
                + " ".join(shlex.quote(x) for x in script_cmd)
            )
        else:
            full_cmd = (
                f"nnUNet_N_proc_DA={shlex.quote(os.getenv('EPAI_N_PROC_DA', '36'))} "
                f"nnUNet_raw={shlex.quote(nnunet_raw)} "
                f"nnUNet_preprocessed={shlex.quote(nnunet_preprocessed)} "
                f"nnUNet_results={shlex.quote(nnunet_results)} "
                f"CUDA_VISIBLE_DEVICES={shlex.quote(selected_gpu)} "
                f"{shlex.quote(conda_exe)} run -n {shlex.quote(epai_env_name)} "
                f"nnUNetv2_predict_from_modelfolder "
                f"-i {shlex.quote(input_dir)} "
                f"-o {shlex.quote(save_dir)} "
                f"-m {shlex.quote(ckpt_path)} "
                f"-f all "
                f"--input_csv {shlex.quote(input_csv_path)} "
                f"--output_csv {shlex.quote(output_csv_path)} "
                f"--continue_prediction "
                f"--save_probabilities "
                f"-npp {shlex.quote(os.getenv('EPAI_NPP', '3'))} "
                f"-nps {shlex.quote(os.getenv('EPAI_NPS', '3'))} "
                f"-num_parts 1 "
                f"-part_id 0 "
                f"-chk {shlex.quote(os.getenv('EPAI_CHECKPOINT_NAME', 'checkpoint_final.pth'))}"
            )

    print(f"[INFO] Running ePAI command for case {case_id}")
    print(full_cmd)
    try:
        subprocess.run(full_cmd, shell=True, executable="/bin/bash", check=True)
    except subprocess.CalledProcessError as e:
        print(f"[ERROR] ePAI inference command failed: {e}")
        return None

    case_pred = os.path.join(save_dir, f"{case_id}.nii.gz")
    if not os.path.exists(case_pred):
        print(f"[ERROR] Expected ePAI output not found: {case_pred}")
        return None

    output_ct_dir = os.path.join(session_dir, "outputs", "ct")
    os.makedirs(output_ct_dir, exist_ok=True)
    combined_label_path = os.path.join(output_ct_dir, "combined_labels.nii.gz")
    shutil.copy2(case_pred, combined_label_path)
    shutil.copy2(output_csv_path, os.path.join(output_ct_dir, "output.csv"))

    return output_ct_dir
