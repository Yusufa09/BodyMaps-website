from flask import Blueprint, send_file, make_response, request, jsonify
from services.nifti_processor import NiftiProcessor
from services.session_manager import SessionManager, generate_uuid
from services.auto_segmentor import run_auto_segmentation
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
from dotenv import load_dotenv

# Load environment variables
load_dotenv()
import nibabel as nib
import uuid

from datetime import datetime, timedelta
from .utils import *
api_blueprint = Blueprint('api', __name__)
last_session_check = datetime.now()
from flask import Blueprint, request, jsonify
progress_tracker = {}  # {session_id: (start_time, expected_total_seconds)}


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

@api_blueprint.route('/get_preview/<clabel_ids>', methods=['GET'])
def get_preview(clabel_ids):
    # get age and thumbnail
    clabel_ids = clabel_ids.split(",")
    wb = load_workbook(os.path.join(Constants.PANTS_PATH, "data", "metadata.xlsx"))
    sheet = wb["PanTS_metadata"]
    res = {
        x: {
            "sex": "",
            "age": ""
        } for x in clabel_ids
    }
    for clabel_id in clabel_ids:
        for row in sheet.iter_rows(values_only=True):
            if row[0] == get_panTS_id(clabel_id):
                res[clabel_id]["sex"] = row[4]
                res[clabel_id]["age"] = row[5]
                break

    return jsonify(res)

# if not preloaded
@api_blueprint.route('/get_image_preview/<clabel_id>', methods=['GET'])
def get_image_preview(clabel_id):
    # get age and thumbnail
    # subfolder = "LabelTr" if int(clabel_id) < 9000 else "LabelTe"
    subfolder = "ImageTr" if int(clabel_id) < 9000 else "ImageTe"
    # path = os.path.join(Constants.PANTS_PATH, "data", subfolder, get_panTS_id(clabel_id), Constants.COMBINED_LABELS_FILENAME)
    # if not os.path.exists(path):
    #     print(f"File not found: {path}. Making file")
    #     npz_processor = NpzProcessor()
    #     npz_processor.combine_labels(int(clabel_id))

    path = os.path.join(Constants.PANTS_PATH, "data", subfolder, get_panTS_id(clabel_id), "ct.npz")
    arr = np.load(path)["data"]
    bytes = volume_to_png(arr)
    return send_file(
        bytes,
        mimetype="image/png",   
        as_attachment=False,
        download_name=f"{clabel_id}_slice.png"
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

@api_blueprint.route('/progress/<session_id>', methods=['GET'])
def get_progress(session_id):
    if session_id not in progress_tracker:
        return jsonify({"progress": 100})

    start_time, expected_time, done_flag = progress_tracker[session_id]
    elapsed = (datetime.now() - start_time).total_seconds()

    if done_flag:
        if progress < 100:
            progress = 100
    else:
        progress = min(95, int((elapsed / expected_time) * 100))

    return jsonify({"progress": progress})



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
    main_nifti_path = f"{Constants.PANTS_PATH}/data/{subfolder}/{get_panTS_id(clabel_id)}/{Constants.MAIN_NIFTI_FILENAME}"

    if os.path.exists(main_nifti_path):
        response = make_response(send_file(main_nifti_path, mimetype='application/gzip'))

        response.headers['Cross-Origin-Opener-Policy'] = 'same-origin'
        response.headers['Cross-Origin-Embedder-Policy'] = 'require-corp'
        response.headers['Content-Encoding'] = 'gzip'

    else:
        print(f"Could not find filepath: {main_nifti_path}. ")
        return jsonify({"error": "Could not find filepath"}), 404
        
        # npz_path = main_nifti_path.replace(".nii.gz", ".npz")
        # if not os.path.exists(npz_path):   
        #     return jsonify({"error": "Could not find npz filepath"}), 404
        # npz_processor = NpzProcessor()
        # npz_processor.npz_to_nifti(int(clabel_id), combined_label=False, save=True)  
        
        # response = make_response(send_file(main_nifti_path, mimetype='application/gzip'))

        # response.headers['Cross-Origin-Opener-Policy'] = 'same-origin'
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


@api_blueprint.route('/get-segmentations/<combined_labels_id>', methods=['GET'])
def get_segmentations(combined_labels_id):
    subfolder = "LabelTr" if int(combined_labels_id) < 9000 else "LabelTe" 
    nifti_path = f"{Constants.PANTS_PATH}/data/{subfolder}/{get_panTS_id(combined_labels_id)}/{Constants.COMBINED_LABELS_NIFTI_FILENAME}"

    if not os.path.exists(nifti_path):
        print(f"Could not find filepath: {nifti_path}. Creating a new one")
        npz_path = nifti_path.replace(".nii.gz", ".npz")
        npz_processor = NpzProcessor()
        if not os.path.exists(npz_path):   
            print(f"Could not find npz filepath: {npz_path}. Creating a new one")

            # ! pancrea instead of pancreas to include pancreatic labels
            npz_processor.combine_labels(combined_labels_id, keywords={"pancrea": "pancreas"}, save=True)
            
        npz_processor.npz_to_nifti(int(combined_labels_id), combined_label=True, save=True)   

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
        response.headers['Cross-Origin-Opener-Policy'] = 'same-origin'
        response.headers['Cross-Origin-Embedder-Policy'] = 'require-corp'
        response.headers['Content-Encoding'] = 'gzip'

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

@api_blueprint.route('/auto_segment/<session_id>', methods=['POST'])
def auto_segment(session_id):

    if 'MAIN_NIFTI' not in request.files:
        return jsonify({"error": "No CT file provided"}), 400

    ct_file = request.files['MAIN_NIFTI']
    model_name = request.form.get("MODEL_NAME", None)

    # Check if model name is valid
    if model_name is None:
        return {"error": "MODEL_NAME is required."}, 400
    # Step 1: Create a unique session directory to store CT and mask
    session_path = os.path.join(SESSIONS_DIR, session_id)
    os.makedirs(session_path, exist_ok=True)

    # Step 2: Save CT file under this session
    input_path = os.path.join(session_path, ct_file.filename)
    ct_file.save(input_path)

    def do_segmentation_and_zip():
        time.sleep(10)
        output_mask_dir = run_auto_segmentation(input_path, session_dir=session_path, model=model_name)

        if output_mask_dir is None or not os.path.exists(output_mask_dir):
            print(f"❌ Auto segmentation failed for session {session_id}")
            return ##the logic still needs to be improved in the future. when output_mask_dir is none here, no error output at user's end

        zip_path = os.path.join(session_path, "auto_masks.zip")
        with zipfile.ZipFile(zip_path, 'w') as zipf:
            for filename in os.listdir(output_mask_dir):
                if filename.endswith(".nii.gz"):
                    abs_path = os.path.join(output_mask_dir, filename)
                    zipf.write(abs_path, arcname=filename)

        start_time, expected_time, _ = progress_tracker[session_id]
        progress_tracker[session_id] = (start_time, expected_time, True)
        progress_tracker.pop(session_id, None)

        
        
        print(f"✅ Finished segmentation and zipping for session {session_id}")

    #threading.Thread(target=do_segmentation_and_zip).start()
    threading.Thread(target=do_segmentation_and_zip, ).start()
    print("[Server] auto_segment request is returning now")
    return jsonify({"message": "Segmentation started"}), 200



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

#
#@api_blueprint.route('/progress_end/<session_id>', methods=['GET'])
#def progress_end(session_id):
#    progress_tracker.pop(session_id, None)
#    return jsonify({"message": "Progress End"}), 200

@api_blueprint.route('/ping', methods=['GET'])
def ping():
    return jsonify({"message": "pong"}), 200
# @api_blueprint.route('/scheduled_check', methods = ['GET'])
# def scheduled_check():
#     session_manager = SessionManager.instance()
#     session_manager.scheduled_check()
#     stmt = db.select(ApplicationSession)
#     resp = db.session.execute(stmt)
#     print(resp.scalars().all())
#     return 'hi'