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
    # Second dataset (CT-only, no masks yet). CV_%08d ids, CSV metadata.
    # Low-res copies live under CANCERVERSE_LOWRES_PATH/image_only/<case>/ct_lowres.nii.gz.
    CANCERVERSE_PATH = os.environ.get('CANCERVERSE_PATH')
    CANCERVERSE_LOWRES_PATH = os.environ.get('CANCERVERSE_LOWRES_PATH', '/home/visitor/cancerverse_lowres')
    DATASET_PREFIXES = {'PanTS': 'PanTS', 'CancerVerse': 'CV'}
    PERMISSIONS_DIR = os.environ.get('PERMISSIONS_DIR', "/home/visitor/data")
    MESH_PATH = PERMISSIONS_DIR + "/render_only"
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
    
    MODEL_ALIASES = {
        # GE
        "lightspeed 16": "LightSpeed 16",
        "lightspeed16": "LightSpeed 16",
        "lightspeed vct": "LightSpeed VCT",
        "lightspeed qx/i": "LightSpeed QX/i",
        "lightspeed pro 16": "LightSpeed Pro 16",
        "lightspeed pro 32": "LightSpeed Pro 32",
        "lightspeed plus": "LightSpeed Plus",
        "lightspeed ultra": "LightSpeed Ultra",
        # Siemens
        "somatom definition as+": "SOMATOM Definition AS+",
        "somatom definition as": "SOMATOM Definition AS",
        "somatom definition flash": "SOMATOM Definition Flash",
        "somatom definition edge": "SOMATOM Definition Edge",
        "somatom force": "SOMATOM Force",
        "somatom go.top": "SOMATOM Go.Top",
        "somatom plus 4": "SOMATOM PLUS 4",
        "somatom scope": "SOMATOM Scope",
        "somatom definition": "SOMATOM Definition",
        "sensation 4": "Sensation 4",
        "sensation 10": "Sensation 10",
        "sensation 16": "Sensation 16",
        "sensation 40": "Sensation 40",
        "sensation 64": "Sensation 64",
        "sensation cardiac 64": "Sensation Cardiac 64",
        "sensation open": "Sensation Open",
        "emotion 16": "Emotion 16",
        "emotion 6 (2007)": "Emotion 6 (2007)",
        "perspective": "Perspective",
        # Philips
        "brilliance 10": "Brilliance 10",
        "brilliance 16": "Brilliance 16",
        "brilliance 16p": "Brilliance 16P",
        "brilliance 40": "Brilliance 40",
        "brilliance 64": "Brilliance 64",
        "ingenuity core 128": "Ingenuity Core 128",
        "iqon - spectral ct": "IQon - Spectral CT",
        "philips ct aura": "Philips CT Aura",
        "precedence 16p": "Precedence 16P",
        # Canon / Toshiba
        "aquilion one": "Aquilion ONE",
        "aquilion": "Aquilion",
        # GE 其他
        "optima ct540": "Optima CT540",
        "optima ct660": "Optima CT660",
        "optima ct520 series": "Optima CT520 Series",
        "revolution ct": "Revolution CT",
        "revolution evo": "Revolution EVO",
        "discovery st": "Discovery ST",
        "discovery ste": "Discovery STE",
        "discovery mi": "Discovery MI",
        "hispeed ct/i": "HiSpeed CT/i",
        # PET/CT
        "biograph128": "Biograph128",
        "biograph 128": "Biograph128",
    }