import os
import uuid
import subprocess
import signal
import re
import csv
import shlex
import shutil
import threading
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Only one model inference runs at a time to avoid GPU OOM
_gpu_lock = threading.Lock()

# Track the active subprocess so it can be killed
_active_proc: 'subprocess.Popen | None' = None
_active_proc_lock = threading.Lock()


def cancel_all_inference():
    """Kill the currently running inference subprocess (if any)."""
    global _active_proc
    with _active_proc_lock:
        proc = _active_proc
    if proc and proc.poll() is None:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass


def _run_subprocess(cmd: str, **kwargs):
    """Run a shell command, tracking it so cancel_all_inference() can kill it."""
    global _active_proc
    proc = subprocess.Popen(
        cmd,
        shell=True,
        executable='/bin/bash',
        start_new_session=True,
        **kwargs,
    )
    with _active_proc_lock:
        _active_proc = proc
    ret = proc.wait()
    with _active_proc_lock:
        if _active_proc is proc:
            _active_proc = None
    if ret != 0:
        raise subprocess.CalledProcessError(ret, cmd)

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
        os.path.expanduser(os.getenv("CONDA_ACTIVATE_PATH", "").strip()),
        "/root/miniconda3/etc/profile.d/conda.sh",
        "/root/anaconda3/etc/profile.d/conda.sh",
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
    Dispatch to the appropriate model inference function.
    Serialized via _gpu_lock so concurrent requests queue instead of OOM-ing.
    Returns the output directory path on success, raises on failure.
    """
    with _gpu_lock:
        if model == 'ePAI':
            conda_path = _resolve_conda_activate_path()
            return _run_epai_inference(
                input_path=input_path,
                session_dir=session_dir,
                conda_path=conda_path,
                epai_env_name=os.getenv("CONDA_ENV_EPAI", "epai"),
                fallback_script_path=os.getenv("EPAI_SCRIPT_PATH", ""),
            )
        elif model == 'SuPreM':
            return _run_suprem_inference(input_path=input_path, session_dir=session_dir)
        elif model == 'OpenVAE':
            return _run_openvae_inference(input_path=input_path, session_dir=session_dir)
        elif model == 'MedFormer':
            return _run_medformer_inference(input_path=input_path, session_dir=session_dir)
        elif model == 'R-Super':
            return _run_rsuper_inference(input_path=input_path, session_dir=session_dir)
        elif model == 'Atlas-Net':
            conda_path = _resolve_conda_activate_path()
            return _run_atlasnet_inference(
                input_path=input_path,
                session_dir=session_dir,
                conda_path=conda_path,
                atlasnet_env_name=os.getenv("CONDA_ENV_ATLASNET", "epai"),
            )
        elif model == 'ShapeKit':
            return _run_shapekit_inference(input_dir=input_path, session_dir=session_dir)
        else:
            raise ValueError(f"Unknown model: {model}")


# Viewer label scheme (constants.ts segmentation_categories, 1-indexed)
_VIEWER_LABELS = {
    "adrenal_gland_left": 1, "adrenal_gland_right": 2, "aorta": 3,
    "bladder": 4, "celiac_artery": 5, "colon": 6, "common_bile_duct": 7,
    "duodenum": 8, "femur_left": 9, "femur_right": 10, "gall_bladder": 11,
    "kidney_left": 12, "kidney_right": 13, "liver": 14,
    "lung_left": 15, "lung_right": 16, "pancreas": 17,
    "pancreas_body": 18, "pancreas_head": 19, "pancreas_tail": 20,
    "pancreatic_duct": 21, "pancreatic_lesion": 22, "postcava": 23,
    "prostate": 24, "spleen": 25, "stomach": 26,
    "superior_mesenteric_artery": 27, "veins": 28,
    # extended labels for full ePAI output
    "intestine": 29, "renal_vein_left": 30, "renal_vein_right": 31, "cbd_stent": 32,
}

# ePAI model label → viewer label (all 25 classes from dataset.json)
_EPAI_TO_VIEWER = {
    1:  _VIEWER_LABELS["aorta"],
    2:  _VIEWER_LABELS["adrenal_gland_left"],
    3:  _VIEWER_LABELS["adrenal_gland_right"],
    4:  _VIEWER_LABELS["common_bile_duct"],
    5:  _VIEWER_LABELS["celiac_artery"],
    6:  _VIEWER_LABELS["colon"],
    7:  _VIEWER_LABELS["duodenum"],
    8:  _VIEWER_LABELS["gall_bladder"],
    9:  _VIEWER_LABELS["postcava"],
    10: _VIEWER_LABELS["kidney_left"],
    11: _VIEWER_LABELS["kidney_right"],
    12: _VIEWER_LABELS["liver"],
    13: _VIEWER_LABELS["pancreas"],
    14: _VIEWER_LABELS["pancreatic_duct"],
    15: _VIEWER_LABELS["superior_mesenteric_artery"],
    16: _VIEWER_LABELS["intestine"],
    17: _VIEWER_LABELS["spleen"],
    18: _VIEWER_LABELS["stomach"],
    19: _VIEWER_LABELS["veins"],
    20: _VIEWER_LABELS["renal_vein_left"],
    21: _VIEWER_LABELS["renal_vein_right"],
    22: _VIEWER_LABELS["cbd_stent"],
    23: _VIEWER_LABELS["pancreatic_lesion"],  # pancreatic_pdac
    24: _VIEWER_LABELS["pancreatic_lesion"],  # pancreatic_cyst
    25: _VIEWER_LABELS["pancreatic_lesion"],  # pancreatic_pnet
}

# Atlas-Net model label → viewer label (from dataset.json)
_ATLASNET_TO_VIEWER = {
    1: _VIEWER_LABELS["aorta"],
    2: _VIEWER_LABELS["adrenal_gland_left"],
    3: _VIEWER_LABELS["adrenal_gland_right"],
    4: _VIEWER_LABELS["common_bile_duct"],
    5: _VIEWER_LABELS["celiac_artery"],       # celiac_aa
    6: _VIEWER_LABELS["colon"],
    7: _VIEWER_LABELS["duodenum"],
    8: _VIEWER_LABELS["gall_bladder"],
    9: _VIEWER_LABELS["postcava"],
    10: _VIEWER_LABELS["kidney_left"],
    11: _VIEWER_LABELS["kidney_right"],
    12: _VIEWER_LABELS["liver"],
    13: _VIEWER_LABELS["pancreas"],
    14: _VIEWER_LABELS["pancreatic_duct"],
    15: _VIEWER_LABELS["superior_mesenteric_artery"],
    16: _VIEWER_LABELS["colon"],              # intestine (small intestine)
    17: _VIEWER_LABELS["spleen"],
    18: _VIEWER_LABELS["stomach"],
    19: _VIEWER_LABELS["veins"],
    20: _VIEWER_LABELS["veins"],              # renal_vein_left
    21: _VIEWER_LABELS["veins"],              # renal_vein_right
    # 22: cbd_stent — no viewer equivalent
    23: _VIEWER_LABELS["pancreatic_lesion"],  # pancreatic_pdac
    24: _VIEWER_LABELS["pancreatic_lesion"],  # pancreatic_cyst
    25: _VIEWER_LABELS["pancreatic_lesion"],  # pancreatic_pnet
}

# SuPreM model label → viewer label
_SUPREM_TO_VIEWER = {
    1: _VIEWER_LABELS["spleen"],
    2: _VIEWER_LABELS["kidney_right"],
    3: _VIEWER_LABELS["kidney_left"],
    4: _VIEWER_LABELS["gall_bladder"],
    6: _VIEWER_LABELS["liver"],
    7: _VIEWER_LABELS["stomach"],
    8: _VIEWER_LABELS["aorta"],
    9: _VIEWER_LABELS["postcava"],
    11: _VIEWER_LABELS["pancreas"],
    12: _VIEWER_LABELS["adrenal_gland_right"],
    13: _VIEWER_LABELS["adrenal_gland_left"],
    14: _VIEWER_LABELS["duodenum"],
    16: _VIEWER_LABELS["lung_right"],
    17: _VIEWER_LABELS["lung_left"],
    18: _VIEWER_LABELS["colon"],
    21: _VIEWER_LABELS["bladder"],
    22: _VIEWER_LABELS["prostate"],
    23: _VIEWER_LABELS["femur_left"],
    24: _VIEWER_LABELS["femur_right"],
    25: _VIEWER_LABELS["celiac_artery"],
}


def _remap_combined_labels(nii_path: str, label_map: dict) -> None:
    """Remap integer labels in a NIfTI file in-place to match the viewer's scheme."""
    import nibabel as nib
    import numpy as np
    img = nib.load(nii_path)
    data = np.asarray(img.dataobj).copy()
    remapped = np.zeros_like(data)
    for src, dst in label_map.items():
        remapped[data == src] = dst
    nib.save(nib.Nifti1Image(remapped, img.affine, img.header), nii_path)


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

    if _is_truthy(os.getenv("EPAI_REMOTE_ENABLED", "false")):
        _run_epai_remote_inference(
            case_id=case_id,
            input_path=input_path,
            input_csv_path=input_csv_path,
            output_csv_path=output_csv_path,
            save_dir=save_dir,
            ckpt_path=ckpt_path,
            nnunet_raw=nnunet_raw,
            nnunet_preprocessed=nnunet_preprocessed,
            nnunet_results=nnunet_results,
            epai_env_name=epai_env_name,
        )
    else:
        selected_gpu = get_least_used_gpu()

        if fallback_script_path and os.path.exists(fallback_script_path):
            script_cmd = [
                "bash", fallback_script_path, session_dir, case_id,
                input_dir, save_dir, input_csv_path, output_csv_path, ckpt_path,
            ]
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
                raise RuntimeError("Could not find conda. Set CONDA_ACTIVATE_PATH or ensure `conda` is on PATH.")

            if fallback_script_path and os.path.exists(fallback_script_path):
                script_cmd = [
                    "bash", fallback_script_path, session_dir, case_id,
                    input_dir, save_dir, input_csv_path, output_csv_path, ckpt_path,
                ]
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
                    f"-npp {shlex.quote(os.getenv('EPAI_NPP', '3'))} "
                    f"-nps {shlex.quote(os.getenv('EPAI_NPS', '3'))} "
                    f"-num_parts 1 "
                    f"-part_id 0 "
                    f"-chk {shlex.quote(os.getenv('EPAI_CHECKPOINT_NAME', 'checkpoint_final.pth'))}"
                )

        print(f"[INFO] Running ePAI command for case {case_id}")
        print(full_cmd)
        try:
            _run_subprocess(full_cmd)
        except subprocess.CalledProcessError as e:
            raise RuntimeError(
                "ePAI inference command failed"
                f"\nCommand: {full_cmd}"
                f"\nExit code: {e.returncode}"
            ) from e

    case_pred = os.path.join(save_dir, f"{case_id}.nii.gz")
    if not os.path.exists(case_pred):
        raise RuntimeError(f"Expected ePAI output not found: {case_pred}")

    output_ct_dir = os.path.join(session_dir, "outputs", "ct")
    os.makedirs(output_ct_dir, exist_ok=True)
    combined_label_path = os.path.join(output_ct_dir, "combined_labels.nii.gz")
    shutil.copy2(case_pred, combined_label_path)
    shutil.copy2(output_csv_path, os.path.join(output_ct_dir, "output.csv"))
    _remap_combined_labels(combined_label_path, _EPAI_TO_VIEWER)

    return output_ct_dir


def _run_suprem_inference(input_path: str, session_dir: str) -> str:
    """
    Run SuPreM segmentation natively using the extracted inference.py.

    Input layout:
        <session_dir>/suprem/inputs/ct/ct.nii.gz

    Output layout written by inference.py:
        <session_dir>/suprem/outputs/ct/combined_labels.nii.gz
        <session_dir>/suprem/outputs/ct/segmentations/*.nii.gz
    """
    suprem_workspace = os.path.join(session_dir, "suprem")
    input_case_dir = os.path.join(suprem_workspace, "inputs", "ct")
    output_dir = os.path.join(suprem_workspace, "outputs")
    os.makedirs(input_case_dir, exist_ok=True)
    os.makedirs(output_dir, exist_ok=True)

    # inference.py expects the file named ct.nii.gz inside a case subfolder
    ct_link = os.path.join(input_case_dir, "ct.nii.gz")
    if os.path.lexists(ct_link):
        os.remove(ct_link)
    os.symlink(os.path.abspath(input_path), ct_link)

    suprem_src = os.getenv("SUPREM_SRC_PATH", "/home/visitor/suprem_native/workspace/SuPreM")
    checkpoint = os.getenv(
        "SUPREM_CHECKPOINT_PATH",
        "/home/visitor/suprem_native/workspace/SuPreM/pretrained_checkpoints/supervised_suprem_unet_2100.pth",
    )
    conda_env = os.getenv("CONDA_ENV_SUPREM", "suprem")
    conda_exe = shutil.which("conda") or "/home/apps/anaconda3/condabin/conda"
    selected_gpu = get_least_used_gpu()
    inputs_dir = os.path.join(suprem_workspace, "inputs")

    full_cmd = (
        f"CUDA_VISIBLE_DEVICES={shlex.quote(selected_gpu)} "
        f"{shlex.quote(conda_exe)} run -n {shlex.quote(conda_env)} "
        f"python -W ignore {shlex.quote(os.path.join(suprem_src, 'inference.py'))} "
        f"--data_root_path {shlex.quote(inputs_dir)} "
        f"--save_dir {shlex.quote(output_dir)} "
        f"--checkpoint {shlex.quote(checkpoint)} "
        f"--backbone unet "
        f"--suprem "
        f"--store_result"
    )

    print(f"[INFO] Running SuPreM native inference")
    print(full_cmd)
    try:
        _run_subprocess(full_cmd, cwd=suprem_src)
    except subprocess.CalledProcessError as e:
        raise RuntimeError(
            f"SuPreM inference failed\nCommand: {full_cmd}\nExit code: {e.returncode}"
        ) from e

    case_output = os.path.join(output_dir, "ct")
    if not os.path.isdir(case_output):
        raise RuntimeError(f"SuPreM output directory not found: {case_output}")

    combined_label_path = os.path.join(case_output, "combined_labels.nii.gz")
    if os.path.exists(combined_label_path):
        _remap_combined_labels(combined_label_path, _SUPREM_TO_VIEWER)

    return case_output


def _run_openvae_inference(input_path: str, session_dir: str) -> str:
    """
    Run OpenVAE 3D reconstruction via sliding-window patch inference.

    Output layout:
        <session_dir>/openvae/reconstructed_ct.nii.gz
    """
    output_dir = os.path.join(session_dir, "openvae")
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, "reconstructed_ct.nii.gz")

    openvae_src = os.getenv("OPENVAE_SRC_PATH", "/home/visitor/openvae")
    checkpoint = os.getenv("OPENVAE_CHECKPOINT_PATH",
                           "/home/visitor/openvae/ckpt/OpenVAE-3D-4x-patch64-10K/autoencoder_best.pt")
    conda_env = os.getenv("CONDA_ENV_OPENVAE", "openvae")
    conda_exe = shutil.which("conda") or "/home/apps/anaconda3/condabin/conda"
    selected_gpu = get_least_used_gpu()

    inference_script = os.path.join(openvae_src, "test", "test_3dvae.py")

    # Use fine-tuned OpenVAE weights if present; fall back to public MAISI checkpoint
    use_maisi_fallback = not os.path.exists(checkpoint)
    if use_maisi_fallback:
        print(f"[INFO] OpenVAE checkpoint not found at {checkpoint}; using --maisi_ckpt (public MONAI MAISI autoencoder)")
        ckpt_arg = "--maisi_ckpt"
        patch_arg = "--patch_size 80 80 80"
    else:
        ckpt_arg = f"--checkpoint {shlex.quote(checkpoint)}"
        patch_arg = "--patch_size 64 64 64"

    full_cmd = (
        f"CUDA_VISIBLE_DEVICES={shlex.quote(selected_gpu)} "
        f"{shlex.quote(conda_exe)} run -n {shlex.quote(conda_env)} "
        f"python {shlex.quote(inference_script)} "
        f"--input {shlex.quote(os.path.abspath(input_path))} "
        f"{ckpt_arg} "
        f"--output {shlex.quote(output_path)} "
        f"{patch_arg} "
        f"--amp"
    )
    print(f"[INFO] Running OpenVAE inference\n{full_cmd}")
    try:
        _run_subprocess(full_cmd, cwd=openvae_src)
    except subprocess.CalledProcessError as e:
        raise RuntimeError(
            f"OpenVAE inference failed\nCommand: {full_cmd}\nExit code: {e.returncode}"
        ) from e

    if not os.path.exists(output_path):
        raise RuntimeError(f"OpenVAE output not found: {output_path}")

    return output_dir


def _combine_medformer_masks(raw_save_path: str, bdmap_id: str, output_path: str):
    """
    Combine MedFormer's per-organ binary masks into a single combined_labels.nii.gz
    using the viewer's integer label scheme.
    """
    import glob
    import nibabel as nib
    import numpy as np

    # MedFormer appends dataset/model_name to save_path; use glob to find predictions dir
    pred_dirs = glob.glob(os.path.join(raw_save_path, "**", bdmap_id, "predictions"), recursive=True)
    if not pred_dirs:
        raise RuntimeError(f"No predictions directory found under {raw_save_path}")

    pred_dir = pred_dirs[0]
    mask_files = glob.glob(os.path.join(pred_dir, "*.nii.gz"))
    if not mask_files:
        raise RuntimeError(f"No mask files found in {pred_dir}")

    ref_img = nib.load(mask_files[0])
    combined = np.zeros(ref_img.shape, dtype=np.uint8)

    for mask_file in mask_files:
        organ_name = os.path.basename(mask_file).replace(".nii.gz", "")
        label_int = _VIEWER_LABELS.get(organ_name)
        if label_int is None:
            continue
        mask_data = np.asarray(nib.load(mask_file).dataobj)
        combined[mask_data > 0] = label_int

    nib.save(nib.Nifti1Image(combined, ref_img.affine, ref_img.header), output_path)


def _run_medformer_inference(input_path: str, session_dir: str) -> str:
    """
    Run MedFormer segmentation (26 abdominal structures + pancreatic lesion).
    Outputs combined_labels.nii.gz mapped to the viewer's label scheme.
    """
    output_dir = os.path.join(session_dir, "medformer")
    os.makedirs(output_dir, exist_ok=True)

    rsuper_src = os.getenv("RSUPER_SRC_PATH", "/home/visitor/rsuper/rsuper_train")
    checkpoint = os.getenv(
        "MEDFORMER_CHECKPOINT_PATH",
        "/home/visitor/rsuper/MedFormerPanTS/pants_pancreas_release/fold_0_latest.pth",
    )
    class_list = os.getenv(
        "MEDFORMER_CLASS_LIST",
        "/home/visitor/rsuper/MedFormerPanTS/labels_pants.yaml",
    )
    conda_env = os.getenv("CONDA_ENV_MEDFORMER", "rsuper")
    conda_exe = shutil.which("conda") or "/home/apps/anaconda3/condabin/conda"
    selected_gpu = get_least_used_gpu()

    # MedFormer needs the filename to contain ".nii.gz" to enter the NIfTI branch;
    # stage input as a flat BDMAP_00000001.nii.gz directly in the input dir
    bdmap_id = "BDMAP_00000001"
    staging_dir = os.path.join(output_dir, "input")
    os.makedirs(staging_dir, exist_ok=True)
    staged_ct = os.path.join(staging_dir, f"{bdmap_id}.nii.gz")
    if not os.path.exists(staged_ct):
        shutil.copy2(input_path, staged_ct)

    raw_save_path = os.path.join(output_dir, "raw_output")
    os.makedirs(raw_save_path, exist_ok=True)

    inference_script = os.path.join(rsuper_src, "predict_abdomenatlas.py")
    full_cmd = (
        f"CUDA_VISIBLE_DEVICES={shlex.quote(selected_gpu)} "
        f"{shlex.quote(conda_exe)} run -n {shlex.quote(conda_env)} "
        f"python {shlex.quote(inference_script)} "
        f"--load {shlex.quote(checkpoint)} "
        f"--img_path {shlex.quote(os.path.join(output_dir, 'input'))} "
        f"--class_list {shlex.quote(class_list)} "
        f"--save_path {shlex.quote(raw_save_path)} "
        f"--gpu {shlex.quote(selected_gpu)} "
        f"--organ_mask_on_lesion"
    )
    print(f"[INFO] Running MedFormer inference\n{full_cmd}")
    try:
        _run_subprocess(full_cmd, cwd=rsuper_src)
    except subprocess.CalledProcessError as e:
        raise RuntimeError(
            f"MedFormer inference failed\nCommand: {full_cmd}\nExit code: {e.returncode}"
        ) from e

    combined_label_path = os.path.join(output_dir, "combined_labels.nii.gz")
    _combine_medformer_masks(raw_save_path, bdmap_id, combined_label_path)

    if not os.path.exists(combined_label_path):
        raise RuntimeError(f"MedFormer combined_labels not created at {combined_label_path}")

    return output_dir


def _run_rsuper_inference(input_path: str, session_dir: str) -> str:
    """
    Run R-Super (MedFormer + report supervision) segmentation.
    Same pipeline as MedFormer, different checkpoint trained on Merlin + PanTS reports.
    """
    output_dir = os.path.join(session_dir, "rsuper")
    os.makedirs(output_dir, exist_ok=True)

    rsuper_src = os.getenv("RSUPER_SRC_PATH", "/home/visitor/rsuper/rsuper_train")
    checkpoint = os.getenv(
        "RSUPER_CHECKPOINT_PATH",
        "/home/visitor/rsuper/R-SuperPanTSMerlin/merlin_pancreas_pants_release/fold_0_latest.pth",
    )
    class_list = os.getenv(
        "MEDFORMER_CLASS_LIST",
        "/home/visitor/rsuper/MedFormerPanTS/labels_pants.yaml",
    )
    conda_env = os.getenv("CONDA_ENV_MEDFORMER", "rsuper")
    conda_exe = shutil.which("conda") or "/home/apps/anaconda3/condabin/conda"
    selected_gpu = get_least_used_gpu()

    bdmap_id = "BDMAP_00000001"
    staging_dir = os.path.join(output_dir, "input")
    os.makedirs(staging_dir, exist_ok=True)
    staged_ct = os.path.join(staging_dir, f"{bdmap_id}.nii.gz")
    if not os.path.exists(staged_ct):
        shutil.copy2(input_path, staged_ct)

    raw_save_path = os.path.join(output_dir, "raw_output")
    os.makedirs(raw_save_path, exist_ok=True)

    inference_script = os.path.join(rsuper_src, "predict_abdomenatlas.py")
    full_cmd = (
        f"CUDA_VISIBLE_DEVICES={shlex.quote(selected_gpu)} "
        f"{shlex.quote(conda_exe)} run -n {shlex.quote(conda_env)} "
        f"python {shlex.quote(inference_script)} "
        f"--load {shlex.quote(checkpoint)} "
        f"--img_path {shlex.quote(staging_dir)} "
        f"--class_list {shlex.quote(class_list)} "
        f"--save_path {shlex.quote(raw_save_path)} "
        f"--gpu {shlex.quote(selected_gpu)} "
        f"--organ_mask_on_lesion"
    )
    print(f"[INFO] Running R-Super inference\n{full_cmd}")
    try:
        _run_subprocess(full_cmd, cwd=rsuper_src)
    except subprocess.CalledProcessError as e:
        raise RuntimeError(
            f"R-Super inference failed\nCommand: {full_cmd}\nExit code: {e.returncode}"
        ) from e

    combined_label_path = os.path.join(output_dir, "combined_labels.nii.gz")
    _combine_medformer_masks(raw_save_path, bdmap_id, combined_label_path)

    if not os.path.exists(combined_label_path):
        raise RuntimeError(f"R-Super combined_labels not created at {combined_label_path}")

    return output_dir


def _run_atlasnet_inference(input_path: str, session_dir: str, conda_path: str, atlasnet_env_name: str) -> str:
    case_id = _normalize_case_id(input_path)

    atlasnet_workspace = os.path.join(session_dir, "atlasnet")
    input_dir = os.path.join(atlasnet_workspace, "eval")
    save_dir = os.path.join(atlasnet_workspace, "out")
    os.makedirs(input_dir, exist_ok=True)
    os.makedirs(save_dir, exist_ok=True)

    nnunet_input = os.path.join(input_dir, f"{case_id}_0000.nii.gz")
    if os.path.lexists(nnunet_input):
        os.remove(nnunet_input)
    os.symlink(input_path, nnunet_input)

    ckpt_path = os.getenv(
        "ATLASNET_CKPT_PATH",
        "/home/visitor/atlasnet/model/nnUNet_results/Dataset001_ATLASNet/nnUNetTrainer__nnUNetPlans__3d_fullres",
    )
    nnunet_raw = os.getenv("ATLASNET_NNUNET_RAW", "/home/visitor/atlasnet/nnUNet/raw")
    nnunet_preprocessed = os.getenv("ATLASNET_NNUNET_PREPROCESSED", "/home/visitor/atlasnet/nnUNet/preprocessed")
    nnunet_results = os.getenv("ATLASNET_NNUNET_RESULTS", "/home/visitor/atlasnet/nnUNet/results")

    selected_gpu = get_least_used_gpu()
    conda_exe = shutil.which("conda")
    if not conda_exe:
        raise RuntimeError("Could not find conda. Set CONDA_ACTIVATE_PATH or ensure `conda` is on PATH.")

    full_cmd = (
        f"nnUNet_raw={shlex.quote(nnunet_raw)} "
        f"nnUNet_preprocessed={shlex.quote(nnunet_preprocessed)} "
        f"nnUNet_results={shlex.quote(nnunet_results)} "
        f"CUDA_VISIBLE_DEVICES={shlex.quote(selected_gpu)} "
        f"{shlex.quote(conda_exe)} run -n {shlex.quote(atlasnet_env_name)} "
        f"nnUNetv2_predict_from_modelfolder "
        f"-i {shlex.quote(input_dir)} "
        f"-o {shlex.quote(save_dir)} "
        f"-m {shlex.quote(ckpt_path)} "
        f"-f all "
        f"-npp 2 -nps 2 "
        f"-chk checkpoint_final.pth"
    )

    print(f"[INFO] Running Atlas-Net command for case {case_id}")
    print(full_cmd)
    try:
        _run_subprocess(full_cmd)
    except subprocess.CalledProcessError as e:
        raise RuntimeError(
            f"Atlas-Net inference command failed\nCommand: {full_cmd}\nExit code: {e.returncode}"
        ) from e

    case_pred = os.path.join(save_dir, f"{case_id}.nii.gz")
    if not os.path.exists(case_pred):
        raise RuntimeError(f"Expected Atlas-Net output not found: {case_pred}")

    output_ct_dir = os.path.join(session_dir, "outputs", "ct")
    os.makedirs(output_ct_dir, exist_ok=True)
    combined_label_path = os.path.join(output_ct_dir, "combined_labels.nii.gz")
    shutil.copy2(case_pred, combined_label_path)
    _remap_combined_labels(combined_label_path, _ATLASNET_TO_VIEWER)

    return output_ct_dir


def _is_truthy(value: str) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "on"}


def _run_checked_process(cmd: list[str], error_prefix: str):
    process = subprocess.run(cmd, text=True, capture_output=True)
    if process.returncode != 0:
        raise RuntimeError(
            f"{error_prefix}"
            f"\nCommand: {' '.join(shlex.quote(x) for x in cmd)}"
            f"\nExit code: {process.returncode}"
            f"\nSTDOUT:\n{(process.stdout or '').strip()}"
            f"\nSTDERR:\n{(process.stderr or '').strip()}"
        )
    return process


def _run_epai_remote_inference(
    case_id: str,
    input_path: str,
    input_csv_path: str,
    output_csv_path: str,
    save_dir: str,
    ckpt_path: str,
    nnunet_raw: str,
    nnunet_preprocessed: str,
    nnunet_results: str,
    epai_env_name: str,
):
    remote_host = (os.getenv("EPAI_REMOTE_HOST", "") or "").strip()
    remote_user = (os.getenv("EPAI_REMOTE_USER", "") or "").strip()
    if not remote_host or not remote_user:
        raise RuntimeError("EPAI remote mode is enabled, but EPAI_REMOTE_HOST or EPAI_REMOTE_USER is missing.")

    remote_port = str((os.getenv("EPAI_REMOTE_SSH_PORT", "22") or "22").strip())
    remote_base_dir = (os.getenv("EPAI_REMOTE_BASE_DIR", "/tmp/epai_jobs") or "/tmp/epai_jobs").strip()
    remote_env = (os.getenv("EPAI_REMOTE_CONDA_ENV", epai_env_name) or epai_env_name).strip()
    remote_conda_activate_path = (os.getenv("EPAI_REMOTE_CONDA_ACTIVATE_PATH", "") or "").strip()
    remote_conda_exe = (os.getenv("EPAI_REMOTE_CONDA_EXE", "conda") or "conda").strip()

    remote_ckpt_path = (os.getenv("EPAI_REMOTE_CKPT_PATH", ckpt_path) or ckpt_path).strip()
    remote_nnunet_raw = (os.getenv("EPAI_REMOTE_NNUNET_RAW", nnunet_raw) or nnunet_raw).strip()
    remote_nnunet_preprocessed = (
        os.getenv("EPAI_REMOTE_NNUNET_PREPROCESSED", nnunet_preprocessed) or nnunet_preprocessed
    ).strip()
    remote_nnunet_results = (os.getenv("EPAI_REMOTE_NNUNET_RESULTS", nnunet_results) or nnunet_results).strip()
    remote_gpu = (os.getenv("EPAI_REMOTE_GPU", "0") or "0").strip()

    remote_job_dir = f"{remote_base_dir.rstrip('/')}/{case_id}_{uuid.uuid4().hex[:8]}"
    remote_input_dir = f"{remote_job_dir}/eval"
    remote_save_dir = f"{remote_job_dir}/out"
    remote_case_input = f"{remote_input_dir}/{case_id}_0000.nii.gz"
    remote_input_csv = f"{remote_job_dir}/input.csv"
    remote_output_csv = f"{remote_job_dir}/output.csv"
    remote_pred = f"{remote_save_dir}/{case_id}.nii.gz"

    remote_target = f"{remote_user}@{remote_host}"

    _run_checked_process(
        ["ssh", "-p", remote_port, remote_target, f"mkdir -p {shlex.quote(remote_input_dir)} {shlex.quote(remote_save_dir)}"],
        "Failed to initialize remote ePAI workspace",
    )

    _run_checked_process(
        ["scp", "-P", remote_port, input_path, f"{remote_target}:{remote_case_input}"],
        "Failed to copy CT file to remote GPU server",
    )
    _run_checked_process(
        ["scp", "-P", remote_port, input_csv_path, f"{remote_target}:{remote_input_csv}"],
        "Failed to copy input CSV to remote GPU server",
    )
    _run_checked_process(
        ["scp", "-P", remote_port, output_csv_path, f"{remote_target}:{remote_output_csv}"],
        "Failed to copy output CSV template to remote GPU server",
    )

    inference_cmd = (
        f"nnUNet_N_proc_DA={shlex.quote(os.getenv('EPAI_N_PROC_DA', '36'))} "
        f"nnUNet_raw={shlex.quote(remote_nnunet_raw)} "
        f"nnUNet_preprocessed={shlex.quote(remote_nnunet_preprocessed)} "
        f"nnUNet_results={shlex.quote(remote_nnunet_results)} "
        f"CUDA_VISIBLE_DEVICES={shlex.quote(remote_gpu)} "
        f"nnUNetv2_predict_from_modelfolder "
        f"-i {shlex.quote(remote_input_dir)} "
        f"-o {shlex.quote(remote_save_dir)} "
        f"-m {shlex.quote(remote_ckpt_path)} "
        f"-f all "
        f"--input_csv {shlex.quote(remote_input_csv)} "
        f"--output_csv {shlex.quote(remote_output_csv)} "
        f"--continue_prediction "
        f"-npp {shlex.quote(os.getenv('EPAI_NPP', '3'))} "
        f"-nps {shlex.quote(os.getenv('EPAI_NPS', '3'))} "
        f"-num_parts 1 "
        f"-part_id 0 "
        f"-chk {shlex.quote(os.getenv('EPAI_CHECKPOINT_NAME', 'checkpoint_final.pth'))}"
    )

    if remote_conda_activate_path:
        remote_run_cmd = (
            f"source {shlex.quote(remote_conda_activate_path)} && "
            f"conda activate {shlex.quote(remote_env)} && "
            f"{inference_cmd}"
        )
    else:
        remote_run_cmd = (
            f"{shlex.quote(remote_conda_exe)} run -n {shlex.quote(remote_env)} "
            f"bash -lc {shlex.quote(inference_cmd)}"
        )

    _run_checked_process(
        ["ssh", "-p", remote_port, remote_target, remote_run_cmd],
        "Remote ePAI inference command failed",
    )

    local_case_pred = os.path.join(save_dir, f"{case_id}.nii.gz")
    _run_checked_process(
        ["scp", "-P", remote_port, f"{remote_target}:{remote_pred}", local_case_pred],
        "Failed to download remote ePAI mask output",
    )
    _run_checked_process(
        ["scp", "-P", remote_port, f"{remote_target}:{remote_output_csv}", output_csv_path],
        "Failed to download remote ePAI CSV output",
    )

    if _is_truthy(os.getenv("EPAI_REMOTE_CLEANUP", "true")):
        _run_checked_process(
            ["ssh", "-p", remote_port, remote_target, f"rm -rf {shlex.quote(remote_job_dir)}"],
            "Failed to clean up remote ePAI workspace",
        )


def _run_shapekit_inference(input_dir: str, session_dir: str) -> str:
    """
    Run ShapeKit post-processing on a segmentation output directory.

    ShapeKit expects: input_folder/case_id/segmentations/<organ>.nii.gz
    We receive:       input_dir/combined_labels.nii.gz  (viewer label values)

    Steps:
      1. Split combined_labels.nii.gz into per-organ files in ShapeKit's layout
      2. Run ShapeKit
      3. Reassemble refined organs back into combined_labels.nii.gz with viewer label values
    """
    import numpy as np
    import nibabel as nib

    output_dir = os.path.join(session_dir, "shapekit")
    log_dir    = os.path.join(session_dir, "shapekit_logs")
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(log_dir, exist_ok=True)

    shapekit_src = os.getenv("SHAPEKIT_SRC_PATH", "/home/visitor/ShapeKit")
    conda_env    = os.getenv("CONDA_ENV_SHAPEKIT", "shapekit")
    conda_exe    = shutil.which("conda") or "/home/apps/anaconda3/condabin/conda"
    cpu_count    = os.getenv("SHAPEKIT_CPU_NUM", "16")

    if not os.path.isdir(shapekit_src):
        raise RuntimeError(
            f"ShapeKit source not found at {shapekit_src}. "
            "Install it with:\n"
            f"  git clone https://github.com/BodyMaps/ShapeKit.git {shapekit_src}\n"
            f"  conda create -n {conda_env} python=3.10 -y\n"
            f"  conda run -n {conda_env} pip install -r {shapekit_src}/requirements.txt\n"
            "Or set SHAPEKIT_SRC_PATH and CONDA_ENV_SHAPEKIT env vars to the correct paths."
        )

    # --- Step 1: split combined_labels.nii.gz into per-organ files ---
    combined_path = os.path.join(input_dir, "combined_labels.nii.gz")
    if not os.path.isfile(combined_path):
        raise RuntimeError(
            f"ShapeKit requires combined_labels.nii.gz but it was not found in: {input_dir}"
        )

    # Organs that ShapeKit's config.yaml knows how to process
    _SHAPEKIT_ORGANS = {
        "adrenal_gland_left", "adrenal_gland_right", "aorta", "bladder",
        "colon", "duodenum", "femur_left", "femur_right", "gall_bladder",
        "intestine", "kidney_left", "kidney_right", "liver",
        "lung_left", "lung_right", "pancreas", "postcava", "prostate",
        "spleen", "stomach",
    }
    # viewer label value → organ name
    _label_to_name = {v: k for k, v in _VIEWER_LABELS.items()}

    case_id      = "case001"
    sk_input_dir = os.path.join(session_dir, "shapekit_input")
    seg_dir      = os.path.join(sk_input_dir, case_id, "segmentations")
    os.makedirs(seg_dir, exist_ok=True)

    combined_img  = nib.load(combined_path)
    combined_data = np.asarray(combined_img.dataobj, dtype=np.int16)
    affine, header = combined_img.affine, combined_img.header

    for label_val, organ_name in _label_to_name.items():
        if organ_name not in _SHAPEKIT_ORGANS:
            continue
        mask = (combined_data == label_val).astype(np.int16)
        if not np.any(mask):
            continue
        nib.save(
            nib.Nifti1Image(mask, affine, header),
            os.path.join(seg_dir, f"{organ_name}.nii.gz"),
        )
    print(f"[INFO] Split {len(os.listdir(seg_dir))} organ files into {seg_dir}")

    # --- Step 2: run ShapeKit ---
    sk_raw_output = os.path.join(session_dir, "shapekit_raw")
    os.makedirs(sk_raw_output, exist_ok=True)

    full_cmd = (
        f"{shlex.quote(conda_exe)} run -n {shlex.quote(conda_env)} "
        f"python -W ignore {shlex.quote(os.path.join(shapekit_src, 'main.py'))} "
        f"--input_folder {shlex.quote(os.path.abspath(sk_input_dir))} "
        f"--output_folder {shlex.quote(os.path.abspath(sk_raw_output))} "
        f"--cpu_count {cpu_count} "
        f"--log_folder {shlex.quote(os.path.abspath(log_dir))} "
        f"--continue_prediction"
    )
    print(f"[INFO] Running ShapeKit post-processing\n{full_cmd}")
    try:
        _run_subprocess(full_cmd, cwd=shapekit_src)
    except subprocess.CalledProcessError as e:
        raise RuntimeError(
            f"ShapeKit post-processing failed\nCommand: {full_cmd}\nExit code: {e.returncode}"
        ) from e

    # --- Step 3: reassemble combined_labels.nii.gz with viewer label values ---
    refined_seg_dir = os.path.join(sk_raw_output, case_id, "segmentations")
    if not os.path.isdir(refined_seg_dir):
        raise RuntimeError(f"ShapeKit produced no segmentation output in: {refined_seg_dir}")

    # Start from the original combined labels (preserves labels ShapeKit doesn't touch)
    result_data = combined_data.copy()

    for organ_file in os.listdir(refined_seg_dir):
        if not organ_file.endswith(".nii.gz"):
            continue
        organ_name   = organ_file[: -len(".nii.gz")]
        viewer_label = _VIEWER_LABELS.get(organ_name)
        if viewer_label is None:
            continue
        organ_data = np.asarray(nib.load(os.path.join(refined_seg_dir, organ_file)).dataobj)
        # Clear old pixels for this organ, write refined mask
        result_data[result_data == viewer_label] = 0
        result_data[organ_data > 0] = viewer_label

    nib.save(
        nib.Nifti1Image(result_data, affine, header),
        os.path.join(output_dir, "combined_labels.nii.gz"),
    )
    print(f"[INFO] ShapeKit refined combined_labels saved to {output_dir}")
    return output_dir
