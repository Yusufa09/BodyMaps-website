import os
from dotenv import load_dotenv
import numpy as np
from datetime import datetime

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))


class Constants:
    # app variables
    SESSIONS_DIR_NAME = os.environ.get('SESSIONS_DIR_PATH', 'sessions')
    DB_USER = os.environ.get('DB_USER')
    DB_PASS = os.environ.get('DB_PASS')
    DB_HOST = os.environ.get('DB_HOST')
    DB_NAME = os.environ.get('DB_NAME')

    SCHEDULED_CHECK_INTERVAL = 5  # minutes  

    # api_blueprint variables
    BASE_PATH = os.environ.get('BASE_PATH', '/')
    PANTS_PATH = os.environ.get('PANTS_PATH')
    MAIN_NIFTI_FORM_NAME = 'MAIN_NIFTI'
    MAIN_NPZ_FILENAME = 'ct.npz'
    MAIN_NIFTI_FILENAME = 'ct.nii.gz'
    COMBINED_LABELS_FILENAME = 'combined_labels.npz'
    COMBINED_LABELS_NIFTI_FILENAME = 'combined_labels.nii.gz'
    ORGAN_INTENSITIES_FILENAME = 'organ_intensities.json'
    SESSION_TIMEDELTA = 3  # in days

    # NiftiProcessor Variables
    EROSION_PIXELS = 2
    CUBE_LEN = (2 * EROSION_PIXELS) + 1
    STRUCTURING_ELEMENT = np.ones([CUBE_LEN, CUBE_LEN, CUBE_LEN], dtype=bool)

    DECIMAL_PRECISION_VOLUME = 2
    DECIMAL_PRECISION_HU = 1
    VOXEL_THRESHOLD = 100

    PREDEFINED_LABELS = {
        0: "adrenal_gland_left",
        1: "adrenal_gland_right",
        2: "aorta",
        3: "bladder",
        4:"celiac_artery",
        5: "colon",
        6: "common_bile_duct",
        7: "duodenum",
        8: "femur_left",
        9: "femur_right",
        10: "gall_bladder",
        11: "kidney_left",
        12: "kidney_right",
        13: "liver",
        14: "lung_left",
        15: "lung_right",
        16: "pancreas_body",
        17: "pancreas_head",
        18: "pancreas_tail",
        19: "pancreas",
        20: "pancreatic_duct",
        21: "pancreatic_lesion",
        22: "postcava",
        23: "prostate",
        24: "spleen",
        25: "stomach",
        26: "superior_mesenteric_artery",
        27: "veins"
    }
    
        


