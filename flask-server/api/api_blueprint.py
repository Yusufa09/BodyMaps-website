from flask import Blueprint, send_file, make_response, request, jsonify, Response
from services.nifti_processor import NiftiProcessor
from services.session_manager import SessionManager, generate_uuid
from services.auto_segmentor import run_auto_segmentation
from services.inference_job_queue import InferenceJobQueue
from models.application_session import ApplicationSession
from models.combined_labels import CombinedLabels
from models.base import db
from constants import Constants
import zipfile
import pandas as pd

from pathlib import Path
from io import BytesIO
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import cm

from sqlalchemy.orm import aliased
import os
import io
from dotenv import load_dotenv

# Load environment variables
load_dotenv()
import nibabel as nib
import uuid

from datetime import datetime, timedelta
from .utils import *
import requests  # ⭐ 只在這裡 import 一次 requests

# 建立 blueprint
api_blueprint = Blueprint("api", __name__)
last_session_check = datetime.now()

def _load_metadata_cache():
    try:
        xlsx_path = os.path.join(Constants.PANTS_PATH, "data", "metadata.xlsx")
        df = pd.read_excel(xlsx_path, engine="openpyxl")
        cache = {}
        for _, row in df.iterrows():
            pid = str(row.iloc[0])
            cache[pid] = {
                "sex": row.iloc[4] if pd.notna(row.iloc[4]) else "",
                "age": row.iloc[5] if pd.notna(row.iloc[5]) else "",
                "tumor": int(row.iloc[13]) if pd.notna(row.iloc[13]) else 0,
            }
        return cache
    except Exception:
        return {}

_METADATA_CACHE = _load_metadata_cache()

progress_tracker = {}  # {session_id: (start_time, expected_total_seconds)}

INFERENCE_QUEUE_DIR = os.getenv(
    "INFERENCE_QUEUE_DIR",
    os.path.join(Constants.SESSIONS_DIR_NAME, "inference_queue"),
)
inference_job_queue = InferenceJobQueue(INFERENCE_QUEUE_DIR)


def _worker_api_token():
    return (os.getenv("WORKER_API_TOKEN", "") or "").strip()


def _get_worker_id():
    return (
        request.headers.get("X-Worker-Id")
        or request.args.get("worker_id")
        or (request.get_json(silent=True) or {}).get("worker_id")
        or "worker-unknown"
    )


def _require_worker_auth():
    expected = _worker_api_token()
    if not expected:
        return jsonify({"error": "WORKER_API_TOKEN is not configured on server"}), 500

    provided = (request.headers.get("X-Worker-Token", "") or "").strip()
    if provided != expected:
        return jsonify({"error": "Unauthorized worker token"}), 401
    return None


def _api_prefix_path() -> str:
    base_path = (Constants.BASE_PATH or "/").rstrip("/")
    return f"{base_path}/api" if base_path else "/api"


def _absolute_api_url(path_suffix: str) -> str:
    root = request.url_root.rstrip("/")
    return f"{root}{_api_prefix_path()}{path_suffix}"


def _public_job_payload(job: dict) -> dict:
    response = {
        "job_id": job.get("job_id"),
        "session_id": job.get("session_id"),
        "model": job.get("model"),
        "status": job.get("status"),
        "attempts": job.get("attempts"),
        "max_attempts": job.get("max_attempts"),
        "error": job.get("error"),
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
    }
    if job.get("status") == "succeeded":
        response["download_url"] = _absolute_api_url(f"/jobs/{job.get('job_id')}/download")
    return response


@api_blueprint.route("/proxy-image")
def proxy_image():
    """
    Proxy image requests so the browser only talks to our own origin.
    Front-end will call: /api/proxy-image?url=<encoded_hf_url>
    """
    raw_url = request.args.get("url")
    if not raw_url:
        return Response("Missing url parameter", status=400)

    # 可選安全限制：只允許 HuggingFace 來源
    if not raw_url.startswith("https://huggingface.co/"):
        return Response("Forbidden", status=403)

    try:
        r = requests.get(raw_url, timeout=10)
    except Exception as e:
        return Response(f"Upstream error: {e}", status=502)

    if not r.ok:
        return Response(f"Upstream status {r.status_code}", status=r.status_code)

    content_type = r.headers.get("Content-Type", "image/jpeg")

    resp = Response(r.content, status=200, mimetype=content_type)

    # ⭐ 避免 COEP 再擋圖片
    resp.headers["Cross-Origin-Resource-Policy"] = "cross-origin"
    # resp.headers['Cross-Origin-Opener-Policy'] = 'same-origin'
    # resp.headers['Cross-Origin-Embedder-Policy'] = 'require-corp'

    return resp



from flask import request, jsonify
import numpy as np
import nibabel as nib
from scipy.ndimage import distance_transform_edt, label
from collections import defaultdict
from constants import Constants
import os
from openpyxl import load_workbook


SESSIONS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "tmp")
PDF_DIR = f"{Constants.PANTS_PATH}/data/pdf"
os.makedirs(SESSIONS_DIR, exist_ok=True)
os.makedirs(PDF_DIR, exist_ok=True)

def _arg(name: str, default=None):
    return request.args.get(name, default)

@api_blueprint.route('/get_preview/<clabel_ids>', methods=['GET'])
def get_preview(clabel_ids):
    clabel_ids = clabel_ids.split(",")
    res = {}
    for clabel_id in clabel_ids:
        pid = get_panTS_id(clabel_id)
        entry = _METADATA_CACHE.get(pid, {"sex": "", "age": "", "tumor": 0})
        res[clabel_id] = entry
    return jsonify(res)

# if not preloaded
@api_blueprint.route('/get_image_preview/<clabel_id>', methods=['GET'])
def get_image_preview(clabel_id):
    # get age and thumbnail
    # subfolder = "LabelTr" if int(clabel_id) < 9000 else "LabelTe"
    subfolder = "ProfileTr" if int(clabel_id) < 9000 else "ProfileTe"
    # path = os.path.join(Constants.PANTS_PATH, "data", subfolder, get_panTS_id(clabel_id), Constants.COMBINED_LABELS_FILENAME)
    # if not os.path.exists(path):
    #     print(f"File not found: {path}. Making file")
    #     npz_processor = NpzProcessor()
    #     npz_processor.combine_labels(int(clabel_id))

    path = os.path.join(Constants.PANTS_PATH, subfolder, get_panTS_id(clabel_id), "profile.jpg")
    # arr = np.load(path)["data"]
    # bytes = volume_to_png(arr)
    return send_file(
        path,
        mimetype="image/jpg",   
        as_attachment=False,
        download_name=f"{clabel_id}_slice.jpg"
    )


    

@api_blueprint.route('/get-label-colormap/<clabel_id>', methods=['GET'])
def get_label_colormap(clabel_id):
    subfolder = "LabelTr" if int(clabel_id) < 9000 else "LabelTe"
    
    clabel_path = os.path.join(Constants.PANTS_PATH, "data", subfolder, get_panTS_id(int(clabel_id)),  'combined_labels.nii.gz')

    if not os.path.exists(clabel_path):
        print(f"File not found: {clabel_path}. Making file")
        combine_label_npz(int(clabel_id))
        npzProcessor = NpzProcessor()
        npzProcessor.npz_to_nifti(int(clabel_id))
    try:
        clabel_array = nib.load(clabel_path)
        clabel_array = clabel_array.get_fdata()
        print("[DEBUG] Nifti loaded, shape =", clabel_array.shape)

        filled_array = fill_voids_with_nearest_label(clabel_array)
        print("[DEBUG] fill_voids_with_nearest_label done")

        adjacency = build_adjacency_graph(filled_array)
        print("[DEBUG] build_adjacency_graph done")

        unique_labels = sorted(adjacency.keys())
        color_map, color_usage_count = assign_colors_with_high_contrast(unique_labels, adjacency)
        print("[DEBUG] Color map generated:", color_map, color_usage_count)

        return jsonify(color_map)

    except Exception as e:
        print("[❌ EXCEPTION]", str(e))
        return jsonify({"error": str(e)}), 500




# @api_blueprint.before_request
# def before_request():
#     global last_session_check
#     current_time = datetime.now()
#     if current_time >= last_session_check + timedelta(minutes=Constants.SCHEDULED_CHECK_INTERVAL):
#         session_manager = SessionManager.instance()
#         expired = session_manager.get_expired()
#         for app_session in expired:
#             session_manager.terminate_session(app_session.session_id)
        
#         last_session_check = current_time

@api_blueprint.route('/', methods=['GET'])
def home():
    return "api"


@api_blueprint.route('/upload', methods=['POST'])
def upload():
    try:
        session_id = request.form.get('SESSION_ID')
        if not session_id:
            return jsonify({"error": "No session ID provided"}), 400
        
        base_path = os.path.join(Constants.SESSIONS_DIR_NAME, session_id)
        os.makedirs(base_path, exist_ok=True)

        nifti_multi_dict = request.files
        filenames = list(nifti_multi_dict)
        main_nifti = nifti_multi_dict.get(Constants.MAIN_NIFTI_FORM_NAME)

        if main_nifti:
            main_nifti_path = os.path.join(base_path, Constants.MAIN_NIFTI_FILENAME)
            main_nifti.save(main_nifti_path)
            filenames.remove(Constants.MAIN_NIFTI_FORM_NAME)
        else:
            return jsonify({"error": "Main NIFTI file missing"}), 400

        nifti_processor = NiftiProcessor.from_clabel_path(os.path.join(base_path, Constants.COMBINED_LABELS_FILENAME))

        combined_labels, organ_intensities = nifti_processor.combine_labels(filenames, nifti_multi_dict, save=True)

        resp = {
            'status': "200",
            'session_id': session_id,
            'organ_intensities': organ_intensities
        }
        return jsonify(resp)
    except Exception as e:
        print(f"❌ [Upload Error] {e}")
        return jsonify({"error": "Internal server error"}), 500

@api_blueprint.route('/mask-data', methods=['POST'])
def get_mask_data():
    session_key = request.form.get('sessionKey')
    if not session_key:
        return jsonify({"error": "Missing sessionKey"}), 400

    result = get_mask_data_internal(session_key)
    return jsonify(result)

  
@api_blueprint.route('/get-main-nifti/<clabel_id>', methods=['GET'])
def get_main_nifti(clabel_id):
    subfolder = "ImageTr" if int(clabel_id) < 9000 else "ImageTe"
    case_dir = f"{Constants.PANTS_PATH}/data/{subfolder}/{get_panTS_id(clabel_id)}"
    main_nifti_path = f"{case_dir}/{Constants.MAIN_NIFTI_FILENAME}"

    # ?res=low → serve the precomputed low-res copy when present (much smaller/faster
    # for big full-body scans). Falls back to full res if it hasn't been generated.
    if (request.args.get('res') or '').strip().lower() == 'low':
        low_path = f"{case_dir}/{Constants.MAIN_NIFTI_FILENAME.replace('.nii.gz', '_lowres.nii.gz')}"
        if os.path.exists(low_path):
            main_nifti_path = low_path

    if os.path.exists(main_nifti_path):
        response = make_response(send_file(main_nifti_path, mimetype='application/gzip'))

        response.headers['Cross-Origin-Resource-Policy'] = 'cross-origin'
        # response.headers['Cross-Origin-Embedder-Policy'] = 'require-corp'
        response.headers['Content-Encoding'] = 'gzip'
        # Volumes are immutable per case — let the browser cache so revisits are instant.
        response.headers['Cache-Control'] = 'public, max-age=604800, immutable'

    else:
        print(f"Could not find filepath: {main_nifti_path}. ")
        return jsonify({"error": "Could not find filepath"}), 404
        
        # npz_path = main_nifti_path.replace(".nii.gz", ".npz")
        # if not os.path.exists(npz_path):   
        #     return jsonify({"error": "Could not find npz filepath"}), 404
        # npz_processor = NpzProcessor()
        # npz_processor.npz_to_nifti(int(clabel_id), combined_label=False, save=True)  
        
        # response = make_response(send_file(main_nifti_path, mimetype='application/gzip'))

        # response.headers['Cross-Origin-Resource-Policy'] = 'same-origin'
        # response.headers['Cross-Origin-Embedder-Policy'] = 'require-corp'
        # response.headers['Content-Encoding'] = 'gzip'

    return response




@api_blueprint.route('/get-report/<id>', methods=['GET'])
def get_report(id):
    temp_pdf_path = f"{PDF_DIR}/temp.pdf"
    output_pdf_path = f"{PDF_DIR}/final.pdf"
    try:
        try:
            organ_metrics = get_mask_data_internal(id)
            organ_metrics = organ_metrics.get("organ_metrics", [])
        except Exception as e:
            return jsonify({"error": f"Error loading organ metrics: {str(e)}"}), 500

        subfolder = "ImageTr" if int(id) < 9000 else "ImageTe"
        label_subfolder = "LabelTr" if int(id) < 9000 else "LabelTe"

        base_path = f"{SESSIONS_DIR}/{id}"
        ct_path = f"{Constants.PANTS_PATH}/data/{subfolder}/{get_panTS_id(id)}/{Constants.MAIN_NIFTI_FILENAME}"
        masks = f"{Constants.PANTS_PATH}/data/{label_subfolder}/{get_panTS_id(id)}/{Constants.COMBINED_LABELS_NIFTI_FILENAME}"
        
        npz_processor = NpzProcessor()

        # if (not os.path.exists(ct_path)):
        #     npz_processor.npz_to_nifti(int(id), combined_label=False, save=True)

        if (not os.path.exists(masks)): 
            npz_processor.combine_labels(int(id), keywords={"pancrea": "pancreas"}, save=True)
            npz_processor.npz_to_nifti(int(id), combined_label=True, save=True)
            
        template_pdf = os.getenv("TEMPLATE_PATH", "report_template_3.pdf")

        extracted_data = None
        column_headers = None
        try:
            csv_path = f"{base_path}/info.csv"
            df = pd.read_csv(csv_path)
            extracted_data = df.iloc[0] if len(df) > 0 else None
            column_headers = df.columns.tolist()
        except Exception:
            pass

        generate_pdf_with_template(
            output_pdf=output_pdf_path,
            folder_name=id,
            ct_path=ct_path,
            mask_path=masks,
            template_pdf=template_pdf,
            temp_pdf_path=temp_pdf_path,
            id=id,
            extracted_data=extracted_data,
            column_headers=column_headers
        )

        return send_file(
            output_pdf_path,
            mimetype="application/pdf",
            as_attachment=True,
            download_name=f"report_{id}.pdf"
        )

    except Exception as e:
        return jsonify({"error": f"Unhandled error: {str(e)}"}), 500

    finally:
        if os.path.exists(temp_pdf_path):
            os.remove(temp_pdf_path)

@api_blueprint.route('/get-specific-segmentations/<combined_labels_id>', methods=['POST'])
async def get_specific_segmentations(combined_labels_id):
    combined_labels_id = combined_labels_id.replace("PanTS_", "")
    combined_labels_id = combined_labels_id.lstrip("0")
    try: 
        organs = json.loads(request.form["organs"])
        niftiProcessor = NpzProcessor()
        combined_labels, intensities, affine, header = niftiProcessor.nifti_combine_labels(int(combined_labels_id), {"foo": "bar"}, save=False, organs=organs)
        if combined_labels.dtype != np.uint8:
            data_uint8 = combined_labels.astype(np.uint8)
            new_img = nib.Nifti1Image(data_uint8, affine, header=header)
            new_img.set_data_dtype(np.uint8)
        else:
            new_img = nib.Nifti1Image(combined_labels, affine, header=header)
            new_img.set_data_dtype(np.uint8)
        
        buffer = io.BytesIO()
        file_map = new_img.make_file_map()
        file_map['image'].fileobj = buffer
        new_img.to_file_map(file_map)

        buffer.seek(0)
        
        response = send_file(buffer, as_attachment=True, download_name="combined_specific_labels.nii.gz", mimetype="application/gzip")
        response.headers["Cross-Origin-Resource-Policy"] = "cross-origin"
        return response
    except Exception as e: 
        return jsonify({"error": f"Error loading organ metrics: {str(e)}"}), 500
@api_blueprint.route('/get-segmentations/<combined_labels_id>', methods=['GET'])
async def get_segmentations(combined_labels_id):
    subfolder = "LabelTr" if int(combined_labels_id) < 9000 else "LabelTe"
    nifti_path = f"{Constants.PANTS_PATH}/data/{subfolder}/{get_panTS_id(combined_labels_id)}/{Constants.COMBINED_LABELS_NIFTI_FILENAME}"
    labels = list(Constants.PREDEFINED_LABELS.values())

    # ?res=low → serve the precomputed low-res mask (paired with the low-res CT so the
    # overlay stays aligned). Falls back to full res below if it hasn't been generated.
    if (request.args.get('res') or '').strip().lower() == 'low':
        low_path = nifti_path.replace('.nii.gz', '_lowres.nii.gz')
        if os.path.exists(low_path):
            response = make_response(send_file(low_path, mimetype='application/gzip'))
            response.headers["Cross-Origin-Resource-Policy"] = "cross-origin"
            response.headers['Content-Encoding'] = 'gzip'
            response.headers['Cache-Control'] = 'public, max-age=604800, immutable'
            return response

    if not os.path.exists(nifti_path):
        await store_files(combined_labels_id)
        niftiProcessor = NpzProcessor()
        niftiProcessor.nifti_combine_labels(int(combined_labels_id))
        # print(f"Could not find filepath: {nifti_path}. Creating a new one")
        # npz_path = nifti_path.replace(".nii.gz", ".npz")
        # npz_processor = NpzProcessor()
        # if not os.path.exists(npz_path):   
        #     print(f"Could not find npz filepath: {npz_path}. Creating a new one")

        #     # ! pancrea instead of pancreas to include pancreatic labels
        #     npz_processor.combine_labels(combined_labels_id, keywords={"pancrea": "pancreas"}, save=True)
            
        # npz_processor.npz_to_nifti(int(combined_labels_id), combined_label=True, save=True)   

    img = nib.load(nifti_path)
    data = img.get_fdata()
    if img.get_data_dtype() != np.uint8:
        print("⚠️ Detected float label map, converting to uint8 for Niivue compatibility...")

    try:
        img = nib.load(nifti_path)
        data = img.get_fdata()

        if img.get_data_dtype() != np.uint8:
            
            data_uint8 = data.astype(np.uint8)
            new_img = nib.Nifti1Image(data_uint8, img.affine, header=img.header)
            new_img.set_data_dtype(np.uint8)

            converted_path = nifti_path#.replace(".nii.gz", "_uint8.nii.gz")

            if not os.path.exists(converted_path):
                nib.save(new_img, converted_path)
        else:
            converted_path = nifti_path

        response = make_response(send_file(converted_path, mimetype='application/gzip'))
        response.headers["Cross-Origin-Resource-Policy"] = "cross-origin"
        response.headers['Content-Encoding'] = 'gzip'
        response.headers['Cache-Control'] = 'public, max-age=604800, immutable'
        # response.headers['Cross-Origin-Opener-Policy'] = 'same-origin'
        # response.headers['Cross-Origin-Embedder-Policy'] = 'require-corp'

        return response

    except Exception as e:
        print(f"❌ [get-segmentations ERROR] {e}")
        return jsonify({"error": str(e)}), 500


@api_blueprint.route('/download/<id>', methods=['GET'])
def download_segmentation_zip(id):
    try:
        subfolder = "LabelTr" if int(id) < 9000 else "LabelTe"
        outputs_ct_folder = Path(f"{Constants.PANTS_PATH}/data/{subfolder}/{get_panTS_id(id)}/segmentations")
        
        if not os.path.exists(outputs_ct_folder):
            return jsonify({"error": "Outputs/ct folder not found"}), 404
        
        files = list(outputs_ct_folder.glob("*"))

        zip_buffer = BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
            for file_path in files:
                zip_file.write(file_path, arcname=file_path.name) 

        zip_buffer.seek(0)  # rewind

        return send_file(
            zip_buffer,
            mimetype="application/zip",
            as_attachment=True,
            download_name=f"case_{id}_segmentations.zip"
        )



    except Exception as e:
        print(f"❌ [Download Error] {e}")
        return jsonify({"error": "Internal server error"}), 500

import threading
import time

inference_jobs = {}  # {session_id: {status, model, error, session_path, zip_path}}


def _set_inference_job(session_id, **kwargs):
    current = inference_jobs.get(session_id, {})
    current.update(kwargs)
    inference_jobs[session_id] = current


def _start_auto_segmentation(session_id, model_name, ct_file=None, server_input_path=None):
    session_path = os.path.join(SESSIONS_DIR, session_id)
    os.makedirs(session_path, exist_ok=True)

    if model_name == 'ShapeKit':
        # ShapeKit takes a segmentation directory from a previous step, not a CT file
        if not server_input_path or not os.path.isdir(server_input_path):
            return jsonify({"error": "ShapeKit requires INPUT_SERVER_PATH pointing to a segmentation output directory"}), 400
        input_path = server_input_path
    elif ct_file is not None:
        input_path = os.path.join(session_path, ct_file.filename)
        ct_file.save(input_path)
    elif server_input_path:
        if not os.path.exists(server_input_path):
            return jsonify({"error": f"INPUT_SERVER_PATH does not exist: {server_input_path}"}), 400
        input_path = os.path.join(session_path, os.path.basename(server_input_path))
        import shutil
        shutil.copy2(server_input_path, input_path)
    else:
        return jsonify({"error": "No CT file provided. Send MAIN_NIFTI or INPUT_SERVER_PATH."}), 400

    _set_inference_job(
        session_id,
        status="running",
        model=model_name,
        error=None,
        ct_path=input_path,
        session_path=session_path,
        zip_path=os.path.join(session_path, "auto_masks.zip"),
    )

    def do_segmentation_and_zip():
        try:
            output_mask_dir = run_auto_segmentation(input_path, session_dir=session_path, model=model_name)

            if output_mask_dir is None or not os.path.exists(output_mask_dir):
                msg = f"Auto segmentation failed for session {session_id}"
                print(f"❌ {msg}")
                _set_inference_job(session_id, status="failed", error=msg)
                return

            zip_path = os.path.join(session_path, "auto_masks.zip")
            with zipfile.ZipFile(zip_path, 'w') as zipf:
                for dirpath, _, filenames in os.walk(output_mask_dir):
                    for filename in filenames:
                        if filename.endswith(".nii.gz") or (model_name == "ePAI" and filename.endswith(".csv")):
                            abs_path = os.path.join(dirpath, filename)
                            arcname = os.path.relpath(abs_path, output_mask_dir)
                            zipf.write(abs_path, arcname=arcname)

            if session_id in progress_tracker:
                start_time, expected_time, _ = progress_tracker[session_id]
                progress_tracker[session_id] = (start_time, expected_time, True)
                progress_tracker.pop(session_id, None)

            _set_inference_job(session_id, status="completed", error=None,
                               zip_path=zip_path, output_mask_dir=output_mask_dir)
            print(f"✅ Finished segmentation and zipping for session {session_id}")
        except Exception as e:
            print(f"❌ Exception while processing session {session_id}: {e}")
            _set_inference_job(session_id, status="failed", error=str(e))

    threading.Thread(target=do_segmentation_and_zip, daemon=True).start()
    print("[Server] auto_segment request is returning now")
    return jsonify({"message": "Segmentation started", "session_id": session_id}), 200

@api_blueprint.route('/auto_segment/<session_id>', methods=['POST'])
def auto_segment(session_id):

    model_name = request.form.get("MODEL_NAME", None)
    server_input_path = request.form.get("INPUT_SERVER_PATH", None)

    ct_file = request.files.get('MAIN_NIFTI')

    # Check if model name is valid
    if model_name is None:
        return {"error": "MODEL_NAME is required."}, 400
    return _start_auto_segmentation(
        session_id=session_id,
        model_name=model_name,
        ct_file=ct_file,
        server_input_path=server_input_path,
    )


@api_blueprint.route('/run-epai-inference', methods=['POST'])
@api_blueprint.route('/run-inference', methods=['POST'])
def run_epai_inference():
    """
    Runs ePAI inference with either:
      1) multipart file: MAIN_NIFTI
      2) server path: INPUT_SERVER_PATH

    Optional fields:
      - session_id
      - uploaded_filename (used with chunked upload output in sessions/inference/<session_id>/)
    """
    payload = request.get_json(silent=True) or {}

    def _pick_text(*keys):
        for key in keys:
            value = request.form.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        for key in keys:
            value = payload.get(key) if isinstance(payload, dict) else None
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    session_id = _pick_text("session_id", "SESSION_ID", "sessionId") or str(uuid.uuid4())
    model_name = _pick_text("model_name", "model", "MODEL_NAME") or "ePAI"
    uploaded_filename = _pick_text("uploaded_filename", "output_filename", "filename")
    input_server_path = _pick_text("INPUT_SERVER_PATH", "input_server_path", "server_path", "path")
    source_reconstruction_session_id = _pick_text("source_reconstruction_session_id")
    ct_file = (
        request.files.get('MAIN_NIFTI')
        or request.files.get('file')
        or request.files.get('ct')
        or request.files.get('ct_file')
    )

    if source_reconstruction_session_id and not input_server_path and ct_file is None:
        source_job = inference_jobs.get(source_reconstruction_session_id, {})
        source_output_dir = source_job.get("output_mask_dir")
        if source_output_dir:
            recon_path = os.path.join(source_output_dir, "reconstructed_ct.nii.gz")
            if os.path.exists(recon_path):
                input_server_path = recon_path
            else:
                return jsonify({"error": f"Reconstructed CT not found for session {source_reconstruction_session_id}"}), 404
        else:
            return jsonify({"error": f"Source reconstruction session {source_reconstruction_session_id} not found or not completed"}), 404

    if not input_server_path and uploaded_filename:
        candidate = os.path.join(Constants.SESSIONS_DIR_NAME, "inference", session_id, uploaded_filename)
        if os.path.exists(candidate):
            input_server_path = candidate

    if not input_server_path and ct_file is None:
        inference_root = os.path.join(Constants.SESSIONS_DIR_NAME, "inference")
        infer_dir = os.path.join(inference_root, session_id)

        if not os.path.isdir(infer_dir) and os.path.isdir(inference_root):
            candidate_dirs = []
            for dirname in os.listdir(inference_root):
                if dirname == session_id or dirname.startswith(session_id) or session_id.startswith(dirname):
                    full_dir = os.path.join(inference_root, dirname)
                    if os.path.isdir(full_dir):
                        candidate_dirs.append(full_dir)
            if len(candidate_dirs) == 1:
                infer_dir = candidate_dirs[0]

        if os.path.isdir(infer_dir):
            nii_candidates = []
            for root, _, files in os.walk(infer_dir):
                for name in files:
                    lower = name.lower()
                    if lower.endswith(".nii.gz") or lower.endswith(".nii"):
                        nii_candidates.append(os.path.join(root, name))

            if nii_candidates:
                preferred = [p for p in nii_candidates if os.path.basename(p).lower() in {"ct.nii.gz", "ct.nii"}]
                pool = preferred if preferred else nii_candidates
                pool.sort(key=lambda p: os.path.getmtime(p), reverse=True)
                input_server_path = pool[0]

    return _start_auto_segmentation(
        session_id=session_id,
        model_name=model_name,
        ct_file=ct_file,
        server_input_path=input_server_path,
    )


@api_blueprint.route('/inference-status/<session_id>', methods=['GET'])
def get_inference_status(session_id):
    job = inference_jobs.get(session_id)
    if job is None:
        return jsonify({"status": "not_found", "session_id": session_id}), 404
    return jsonify({"session_id": session_id, **job}), 200


@api_blueprint.route('/check-inference-status', methods=['GET'])
def check_inference_status_legacy():
    session_id = request.args.get("session_id") or request.args.get("sessionId")
    if not session_id:
        return jsonify({"error": "session_id is required"}), 400
    return get_inference_status(session_id)


@api_blueprint.route('/jobs', methods=['POST'])
def create_pull_inference_job():
    payload = request.get_json(silent=True) or {}

    def _pick_text(*keys):
        for key in keys:
            value = request.form.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        for key in keys:
            value = payload.get(key) if isinstance(payload, dict) else None
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    session_id = _pick_text("session_id", "SESSION_ID", "sessionId") or str(uuid.uuid4())
    input_server_path = _pick_text("input_server_path", "INPUT_SERVER_PATH", "path")
    uploaded_filename = _pick_text("uploaded_filename", "output_filename", "filename")
    model = _pick_text("model", "MODEL_NAME") or "ePAI"

    ct_file = (
        request.files.get('MAIN_NIFTI')
        or request.files.get('file')
        or request.files.get('ct')
        or request.files.get('ct_file')
    )

    if not input_server_path and uploaded_filename:
        candidate = os.path.join(Constants.SESSIONS_DIR_NAME, "inference", session_id, uploaded_filename)
        if os.path.exists(candidate):
            input_server_path = candidate

    if ct_file is not None and not input_server_path:
        target_dir = os.path.join(Constants.SESSIONS_DIR_NAME, "inference", session_id, "input")
        os.makedirs(target_dir, exist_ok=True)
        original_name = os.path.basename(ct_file.filename or "ct.nii.gz")
        target_name = original_name if original_name else "ct.nii.gz"
        input_server_path = os.path.join(target_dir, target_name)
        ct_file.save(input_server_path)

    if not input_server_path:
        return jsonify({"error": "No input provided. Send input_server_path, uploaded_filename, or MAIN_NIFTI."}), 400
    if not os.path.exists(input_server_path):
        return jsonify({"error": f"Input path not found: {input_server_path}"}), 400

    job = inference_job_queue.create_job(
        input_file_path=input_server_path,
        session_id=session_id,
        model=model,
        max_attempts=int(os.getenv("INFERENCE_MAX_ATTEMPTS", "3")),
    )
    return jsonify(_public_job_payload(job)), 201


@api_blueprint.route('/jobs/<job_id>', methods=['GET'])
def get_pull_inference_job(job_id):
    job = inference_job_queue.get_job(job_id)
    if not job:
        return jsonify({"error": "Job not found", "job_id": job_id}), 404
    return jsonify(_public_job_payload(job)), 200


@api_blueprint.route('/jobs/next', methods=['GET'])
def lease_next_pull_job():
    auth_error = _require_worker_auth()
    if auth_error is not None:
        return auth_error

    worker_id = _get_worker_id()
    lease_seconds = int(request.args.get("lease_seconds") or os.getenv("INFERENCE_LEASE_SECONDS", "900"))
    job = inference_job_queue.lease_next_job(worker_id=worker_id, lease_seconds=lease_seconds)
    if not job:
        return ("", 204)

    job_id = job.get("job_id")
    return jsonify({
        "job_id": job_id,
        "session_id": job.get("session_id"),
        "model": job.get("model"),
        "lease_seconds": lease_seconds,
        "input_download_url": _absolute_api_url(f"/jobs/{job_id}/input"),
        "heartbeat_url": _absolute_api_url(f"/jobs/{job_id}/heartbeat"),
        "result_upload_url": _absolute_api_url(f"/jobs/{job_id}/result"),
        "fail_url": _absolute_api_url(f"/jobs/{job_id}/fail"),
        "status_url": _absolute_api_url(f"/jobs/{job_id}"),
    }), 200


@api_blueprint.route('/jobs/<job_id>/input', methods=['GET'])
def download_pull_job_input(job_id):
    auth_error = _require_worker_auth()
    if auth_error is not None:
        return auth_error

    job = inference_job_queue.get_job(job_id)
    if not job:
        return jsonify({"error": "Job not found", "job_id": job_id}), 404

    input_path = job.get("input_file_path")
    if not input_path or not os.path.exists(input_path):
        return jsonify({"error": "Input file missing for job", "job_id": job_id}), 404

    return send_file(input_path, as_attachment=True, download_name=os.path.basename(input_path))


@api_blueprint.route('/jobs/<job_id>/heartbeat', methods=['POST'])
def heartbeat_pull_job(job_id):
    auth_error = _require_worker_auth()
    if auth_error is not None:
        return auth_error

    worker_id = _get_worker_id()
    payload = request.get_json(silent=True) or {}
    lease_seconds = int(payload.get("lease_seconds") or request.form.get("lease_seconds") or os.getenv("INFERENCE_LEASE_SECONDS", "900"))

    try:
        job = inference_job_queue.heartbeat(job_id=job_id, worker_id=worker_id, lease_seconds=lease_seconds)
        if not job:
            return jsonify({"error": "Job not found", "job_id": job_id}), 404
        return jsonify(_public_job_payload(job)), 200
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@api_blueprint.route('/jobs/<job_id>/result', methods=['POST'])
def complete_pull_job(job_id):
    auth_error = _require_worker_auth()
    if auth_error is not None:
        return auth_error

    worker_id = _get_worker_id()
    prediction_file = (
        request.files.get("prediction")
        or request.files.get("mask")
        or request.files.get("combined_labels")
        or request.files.get("file")
    )
    output_csv = request.files.get("output_csv") or request.files.get("csv")

    if prediction_file is None:
        return jsonify({"error": "Missing prediction file (use field: prediction)"}), 400

    temp_dir = os.path.join("/tmp", "pull_job_results", job_id)
    os.makedirs(temp_dir, exist_ok=True)

    pred_path = os.path.join(temp_dir, "combined_labels.nii.gz")
    prediction_file.save(pred_path)

    csv_path = None
    if output_csv is not None:
        csv_path = os.path.join(temp_dir, "output.csv")
        output_csv.save(csv_path)

    try:
        job = inference_job_queue.complete_job(
            job_id=job_id,
            worker_id=worker_id,
            result_mask_path=pred_path,
            result_csv_path=csv_path,
        )
        if not job:
            return jsonify({"error": "Job not found", "job_id": job_id}), 404
        return jsonify(_public_job_payload(job)), 200
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 400


@api_blueprint.route('/jobs/<job_id>/fail', methods=['POST'])
def fail_pull_job(job_id):
    auth_error = _require_worker_auth()
    if auth_error is not None:
        return auth_error

    worker_id = _get_worker_id()
    payload = request.get_json(silent=True) or {}
    error_message = payload.get("error") or request.form.get("error") or "Worker marked job failed"

    try:
        job = inference_job_queue.fail_job(job_id=job_id, worker_id=worker_id, error=error_message)
        if not job:
            return jsonify({"error": "Job not found", "job_id": job_id}), 404
        return jsonify(_public_job_payload(job)), 200
    except PermissionError as e:
        return jsonify({"error": str(e)}), 403


@api_blueprint.route('/jobs/<job_id>/download', methods=['GET'])
def download_pull_job_result(job_id):
    job = inference_job_queue.get_job(job_id)
    if not job:
        return jsonify({"error": "Job not found", "job_id": job_id}), 404
    if job.get("status") != "succeeded":
        return jsonify({"error": "Result not ready", "status": job.get("status")}), 409

    zip_path = job.get("result_zip_path")
    if not zip_path or not os.path.exists(zip_path):
        return jsonify({"error": "Result archive missing"}), 404

    return send_file(zip_path, as_attachment=True, download_name=f"{job_id}_auto_masks.zip")



@api_blueprint.route('/get_result/<session_id>', methods=['GET'])
def get_result(session_id):
    session_path = os.path.join(SESSIONS_DIR, session_id)
    zip_path = os.path.join(session_path, "auto_masks.zip")

    wait_for_file(zip_path, timeout=30)

    response = send_file(
        zip_path,
        as_attachment=True,
        download_name="auto_masks.zip"
    )
    response.headers["X-Session-Id"] = session_id
    return response


@api_blueprint.route('/session-ct/<session_id>', methods=['GET'])
def get_session_ct(session_id):
    job = inference_jobs.get(session_id, {})
    ct_path = job.get("ct_path")
    if not ct_path or not os.path.exists(ct_path):
        return jsonify({"error": "CT file not found for session"}), 404
    response = make_response(send_file(ct_path, mimetype='application/gzip'))
    response.headers['Cross-Origin-Resource-Policy'] = 'cross-origin'
    response.headers['Content-Encoding'] = 'gzip'
    return response


@api_blueprint.route('/session-segmentation/<session_id>', methods=['GET'])
def get_session_segmentation(session_id):
    job = inference_jobs.get(session_id, {})
    output_mask_dir = job.get("output_mask_dir")
    if not output_mask_dir:
        return jsonify({"error": "Segmentation not ready for session"}), 404
    seg_path = os.path.join(output_mask_dir, "combined_labels.nii.gz")
    if not os.path.exists(seg_path):
        return jsonify({"error": f"combined_labels.nii.gz not found at {seg_path}"}), 404
    response = make_response(send_file(seg_path, mimetype='application/gzip'))
    response.headers['Cross-Origin-Resource-Policy'] = 'cross-origin'
    response.headers['Content-Encoding'] = 'gzip'
    return response


@api_blueprint.route('/session-reconstruction/<session_id>', methods=['GET'])
def get_session_reconstruction(session_id):
    """Serves the OpenVAE reconstructed CT for a session."""
    job = inference_jobs.get(session_id, {})
    output_mask_dir = job.get("output_mask_dir")
    if not output_mask_dir:
        return jsonify({"error": "Reconstruction not ready for session"}), 404
    recon_path = os.path.join(output_mask_dir, "reconstructed_ct.nii.gz")
    if not os.path.exists(recon_path):
        return jsonify({"error": f"reconstructed_ct.nii.gz not found"}), 404
    response = make_response(send_file(recon_path, mimetype='application/gzip'))
    response.headers['Cross-Origin-Resource-Policy'] = 'cross-origin'
    response.headers['Content-Encoding'] = 'gzip'
    return response

#
#@api_blueprint.route('/progress_end/<session_id>', methods=['GET'])
#def progress_end(session_id):
#    progress_tracker.pop(session_id, None)
#    return jsonify({"message": "Progress End"}), 200


#### INFERENCE ENDPOINTS ####

CHUNK_DIR = "/tmp/uploads"  # Temporary folder for chunked uploads
os.makedirs(CHUNK_DIR, exist_ok=True)

@api_blueprint.route("/upload-inference-chunk", methods=["POST"])
def upload_inference_chunk():
    """
    Receives a chunk of a file.
    Expects:
        - session_id
        - chunk_index
        - total_chunks
        - file (the chunk itself)
    """
    try:
        session_id = request.form.get("session_id")
        chunk_index = request.form.get("chunk_index")
        total_chunks = request.form.get("total_chunks")
        chunk_file = request.files.get("file")

        if not all([session_id, chunk_index, total_chunks, chunk_file]):
            return jsonify({"error": "Missing parameters"}), 400

        session_folder = os.path.join(CHUNK_DIR, session_id)
        os.makedirs(session_folder, exist_ok=True)

        chunk_path = os.path.join(session_folder, f"chunk-{chunk_index}")
        chunk_file.save(chunk_path)

        return jsonify({"status": "ok", "chunk_index": chunk_index})
    except Exception as e:
        print(f"❌ Chunk upload error: {e}")
        return jsonify({"error": str(e)}), 500


@api_blueprint.route("/finalize-upload", methods=["POST"])
def finalize_upload():
    """
    Combines all chunks into the final file in the proper sessions folder.
    Expects:
        - session_id
        - total_chunks
        - output_filename (optional)
    """
    try:
        session_id = request.form.get("session_id")
        total_chunks = int(request.form.get("total_chunks"))
        output_filename = request.form.get("output_filename", "inference_input.gz")
        requested_bdmap_id = request.form.get("bdmap_id") or request.form.get("case_id")

        if requested_bdmap_id and requested_bdmap_id.strip():
            bdmap_id = requested_bdmap_id.strip()
            if not bdmap_id.startswith("BDMAP_"):
                bdmap_id = f"BDMAP_{bdmap_id}"
        else:
            digits = "".join(ch for ch in (session_id or "") if ch.isdigit())
            if len(digits) < 8:
                fallback_digits = f"{(uuid.uuid5(uuid.NAMESPACE_DNS, session_id or str(uuid.uuid4())).int % (10 ** 8)):08d}"
                digits = (digits + fallback_digits)[:8]
            else:
                digits = digits[:8]
            bdmap_id = f"BDMAP_{digits}"

        # New base path: sessions/inference/<session_id>/
        base_path = os.path.join(Constants.SESSIONS_DIR_NAME, "inference", session_id)
        os.makedirs(base_path, exist_ok=True)

        normalized_output = output_filename.strip()
        lower_name = normalized_output.lower()
        if lower_name.endswith(".nii.gz"):
            target_filename = "ct.nii.gz"
        elif lower_name.endswith(".nii"):
            target_filename = "ct.nii"
        else:
            target_filename = normalized_output

        target_dir = base_path
        if target_filename.lower().endswith(".nii") or target_filename.lower().endswith(".nii.gz"):
            target_dir = os.path.join(base_path, bdmap_id)
            os.makedirs(target_dir, exist_ok=True)

        final_path = os.path.join(target_dir, target_filename)

        # Combine chunks
        temp_folder = os.path.join("/tmp/uploads", session_id)
        with open(final_path, "wb") as out_file:
            for i in range(total_chunks):
                chunk_path = os.path.join(temp_folder, f"chunk-{i}")
                with open(chunk_path, "rb") as f:
                    out_file.write(f.read())

        # Optional: clean up temp chunks
        for i in range(total_chunks):
            os.remove(os.path.join(temp_folder, f"chunk-{i}"))
        os.rmdir(temp_folder)

        uploaded_filename = os.path.relpath(final_path, base_path)
        return jsonify({
            "status": "combined",
            "path": final_path,
            "bdmap_id": bdmap_id,
            "uploaded_filename": uploaded_filename,
        })
    except Exception as e:
        print(f"❌ Finalize upload error: {e}")
        return jsonify({"error": str(e)}), 500

## OTHER ENDPOINTS ##

@api_blueprint.route('/ping', methods=['GET'])
def ping():
    return jsonify({"message": "pong"}), 200

@api_blueprint.route("/search", methods=["GET"])
def api_search():
    # return jsonify({"message": "pong"}), 200
    df = apply_filters(DF).copy()
    sort_by  = (_arg("sort_by", "top") or "top").strip().lower()
    sort_by  = (_arg("sort_by", "top") or "top").strip().lower()
    df = ensure_sort_cols(df)

    # ---- 排序參數 ----
    sort_by  = (_arg("sort_by", "top") or "top").strip().lower()
    sort_dir = (_arg("sort_dir", "asc") or "asc").strip().lower()

    if sort_by in ("top", "quality"):
        by  = ["__complete", "__spacing_sum", "__shape_sum", "__case_sortkey"]
        asc = [False, True, False, True]
    elif sort_by in ("id", "id_asc"):
        by, asc = ["__case_sortkey"], [True]
    elif sort_by == "id_desc":
        by, asc = ["__case_sortkey"], [False]
    elif sort_by in ("shape_desc", "shape"):
        by, asc = ["__shape_sum", "__case_sortkey"], [False, True]
    elif sort_by in ("spacing_asc", "spacing"):
        by, asc = ["__spacing_sum", "__case_sortkey"], [True, True]
    elif sort_by == "age_asc":
        by, asc = ["__age", "__case_sortkey"], [True, True]
    elif sort_by == "age_desc":
        by, asc = ["__age", "__case_sortkey"], [False, True]
    else:
        key_map = {"id": "__case_sortkey", "spacing": "__spacing_sum", "shape": "__shape_sum"}
        k = key_map.get(sort_by, "__case_sortkey")
        by, asc = [k, "__case_sortkey"], [(sort_dir != "desc"), True]

    # ---- 排序 ----
    df = df.sort_values(by=by, ascending=asc, na_position="last", kind="mergesort")

    # ---- 分頁：注意 total 先算完篩選後的完整筆數 ----
    total    = int(len(df))
    page     = max(to_int(_arg("page", "1")) or 1, 1)
    per_page = to_int(_arg("per_page", "24")) or 24
    per_page = max(1, min(per_page, 1_000_000))

    pages = max(1, int(math.ceil(total / per_page)))
    page  = max(1, min(page, pages))
    start, end = (page - 1) * per_page, (page - 1) * per_page + per_page

    # ---- 轉成前端想要的 items ----
    items = [row_to_item(r) for _, r in df.iloc[start:end].iterrows()]
    items = clean_json_list(items)

    return jsonify({
        "items": items,         # ← 前端只讀這個渲染卡片
        "total": total,         # ← 正確的最終數量
        "page": page,
        "per_page": per_page,
        "query": request.query_string.decode(errors="ignore") or ""
    })


def _facet_counts_with_unknown(df: pd.DataFrame, col_key: str, top_k: int = 6) -> Dict[str, Any]:
    """Compute facet rows + unknown count, with robust handling for NaN/strings."""
    rows: List[Dict[str, Any]] = []
    unknown: int = 0

    key_to_col = {
        "ct_phase": ("__ct", str),
        "manufacturer": ("__mfr", str),
        "year": ("__year_int", int),
        "sex": ("__sex", str),
        "tumor": ("__tumor01", int),
        "model": ("model", str),
        "study_type": ("study_type", str),
        "site_nat": ("site_nationality", str),
        "site_nationality": ("site_nationality", str),
    }
    if col_key not in key_to_col:
        return {"rows": [], "unknown": 0}

    col_name, _typ = key_to_col[col_key]
    if col_name not in df.columns:
        return {"rows": [], "unknown": 0}

    ser = df[col_name]

    # ---- Year：數值化、NaN 視為 unknown ----
    if col_key == "year":
        s_num = pd.to_numeric(ser, errors="coerce")
        unknown = int(s_num.isna().sum())
        vc = s_num.dropna().astype(int).value_counts()
        rows = [{"value": int(v), "count": int(c)} for v, c in vc.items()]
        rows.sort(key=lambda x: (-x["count"], x["value"]))
        if top_k and top_k > 0:
            rows = rows[:top_k]
        return {"rows": rows, "unknown": unknown}

    # ---- 其他欄位：把空字串/unknown 類型歸入 unknown ----
    s_str = ser.astype(str).str.strip()
    s_lc = s_str.str.lower()
    unknown_mask = ser.isna() | (s_str == "") | (s_lc.isin({"unknown", "nan", "none", "n/a", "na"}))
    unknown = int(unknown_mask.sum())

    vals = ser[~unknown_mask]
    vc = vals.value_counts(dropna=False)

    tmp_rows: List[Dict[str, Any]] = []
    for v, c in vc.items():
        if col_key == "tumor":
            # tumor 僅接受 0/1
            try:
                iv = int(v)
            except Exception:
                continue
            if iv not in (0, 1):
                continue
            tmp_rows.append({"value": iv, "count": int(c)})
        else:
            tmp_rows.append({"value": v, "count": int(c)})

    # 排序：count desc，再 value 升（字串比較避免型別問題）
    tmp_rows.sort(key=lambda x: (-x["count"], str(x["value"])))
    if top_k and top_k > 0:
        tmp_rows = tmp_rows[:top_k]

    rows = tmp_rows
    return {"rows": rows, "unknown": unknown}


def _prune_zero_rows(rows: List[Dict[str, Any]], keep_zero: bool) -> List[Dict[str, Any]]:
    """依需求濾掉 count<=0；當 keep_zero=True（對應 guarantee=1）則不濾。"""
    if keep_zero:
        return rows
    out: List[Dict[str, Any]] = []
    for r in rows or []:
        try:
            c = int(r.get("count") or 0)
        except Exception:
            c = 0
        if c > 0:
            out.append(r)
    return out


@api_blueprint.route("/facets", methods=["GET"])
def api_facets():
    try:
        fields_raw = (_arg("fields","ct_phase,manufacturer") or "").strip()
        fields = [f.strip().lower() for f in fields_raw.split(",") if f.strip()]

        valid  = {
            "ct_phase","manufacturer","year","sex","tumor",
            "model","study_type","site_nat","site_nationality"
        }
        fields = [f for f in fields if f in valid] or ["ct_phase","manufacturer"]
        top_k  = to_int(_arg("top_k","6")) or 6
        guarantee = (_arg("guarantee","0") or "0").strip().lower() in ("1","true","yes","y")

        # 先應用目前的過濾條件
        df_now = apply_filters(DF)
        base_for_ranges = df_now if len(df_now) else DF

        facets: Dict[str, List[Dict[str, Any]]] = {}
        unknown_counts: Dict[str, int] = {}

        # 為每個 facet 準備自我排除的條件（避免自我影響）
        exclude_map = {
            "ct_phase": {"ct_phase"},
            "manufacturer": {"manufacturer","mfr_is_null","manufacturer_is_null"},
            "year": {"year_from","year_to"},
            "sex": {"sex"},
            "tumor": {"tumor"},
            "model": {"model"},
            "study_type": {"study_type"},
            "site_nat": {"site_nat","site_nationality"},
            "site_nationality": {"site_nat","site_nationality"},
        }

        for f in fields:
            ex = exclude_map.get(f, set())
            # 若 guarantee=1 且目前篩完為空，改用全量 DF 以「保證列出所有可能值」
            src = (DF if (guarantee and len(df_now) == 0) else df_now)
            df_facet = apply_filters(src, exclude=ex)
            res = _facet_counts_with_unknown(df_facet, f, top_k=top_k)

            # guarantee=0 時砍掉 count<=0 的項目
            rows = _prune_zero_rows(res.get("rows") or [], keep_zero=guarantee)
            facets[f] = rows
            unknown_counts[f] = int(res.get("unknown") or 0)

        # 年齡/年份範圍（原樣保留）
        def _minmax(series: pd.Series):
            s = series.dropna()
            if not len(s): return (None, None)
            return (float(s.min()), float(s.max()))

        age_min = age_max = None
        year_min = year_max = None
        if "__age" in base_for_ranges:
            age_min, age_max = _minmax(base_for_ranges["__age"])
        if "__year_int" in base_for_ranges:
            yr = base_for_ranges["__year_int"].dropna().astype(int)
            if len(yr):
                year_min, year_max = int(yr.min()), int(yr.max())

        return jsonify({
            "facets": facets,
            "unknown_counts": unknown_counts,
            "age_range": {"min": age_min, "max": age_max},
            "year_range": {"min": year_min, "max": year_max},
            "total": int(len(df_now)),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 400
    
@api_blueprint.route("/random", methods=['GET'])
def api_random_topk_rotate_norand():
    """
    推薦：完整資料優先 → 取 Top-K(預設100) → 環狀位移 → 可排除最近看過
    排序：__spacing_sum ↑, __shape_sum ↓, __case_sortkey ↑
    """
    try:
        scope = (request.args.get("scope", "filtered") or "filtered").strip().lower()
        base_df = apply_filters(DF)
        if len(base_df) == 0 and scope == "all":
            base_df = DF.copy()

        base_df = ensure_sort_cols(base_df)

        # 只取完整資料；若沒有完整的就退回全部
        df_full = base_df[base_df["__complete"]] if "__complete" in base_df.columns else base_df
        if len(df_full) == 0:
            df_full = base_df
        df = df_full.sort_values(
            by=["__spacing_sum","__shape_sum","__case_sortkey"],
            ascending=[True, False, True],
            na_position="last",
            kind="mergesort",
        )

        if len(df) == 0:
            return jsonify({"items": [], "total": 0, "meta": {"k": 0, "used_recent": 0}}), 200

        # n, k
        try: n = int(request.args.get("n") or 3)
        except Exception: n = 3
        n = max(1, min(n, len(df)))

        try: K = int(request.args.get("k") or 100)
        except Exception: K = 100
        K = max(n, min(K, len(df)))

        # recent 排除
        recent_raw = (request.args.get("recent") or "").strip()
        used_recent = 0
        if recent_raw:
            recent_ids = {s.strip() for s in recent_raw.split(",") if s.strip()}
            key = df["__case_str"].astype(str) if "__case_str" in df.columns else None
            if key is not None:
                mask = ~key.isin(recent_ids)
                used_recent = int((~mask).sum())
                df2 = df[mask]
                if len(df2): df = df2

        topk = df.iloc[:K]
        if len(topk) == 0:
            return jsonify({"items": [], "total": 0, "meta": {"k": 0, "used_recent": used_recent}}), 200

        off_arg = request.args.get("offset")
        if off_arg is not None:
            try: offset = int(off_arg) % len(topk)
            except Exception: offset = 0
        else:
            now = datetime.utcnow()
            offset = ((now.minute * 60) + now.second) % len(topk)

        idx = list(range(len(topk))) + list(range(len(topk)))
        pick = idx[offset:offset + min(n, len(topk))]
        sub = topk.iloc[pick]

        items = [row_to_item(r) for _, r in sub.iterrows()]
        resp = jsonify({
            "items": clean_json_list(items),
            "total": int(len(df)),
            "meta": {"k": int(len(topk)), "used_recent": used_recent, "offset": int(offset)}
        })
        r = make_response(resp)
        r.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        r.headers["Pragma"] = "no-cache"
        r.headers["Expires"] = "0"
        return r

    except Exception as e:
        return jsonify({"error": str(e)}), 400
