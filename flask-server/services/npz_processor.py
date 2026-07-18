import nibabel as nib
import numpy as np
from constants import Constants
from werkzeug.datastructures import MultiDict
import scipy.ndimage as ndimage
import os, sys
import tempfile
from scipy.ndimage import label
import pathlib
from openpyxl import load_workbook
import json

def get_panTS_id(index):
    cur_case_id = str(index)
    iter = max(0, 8 - len(str(index)))
    for _ in range(iter):
        cur_case_id = "0" + cur_case_id
    cur_case_id = "PanTS_" + cur_case_id
    return cur_case_id

def get_cancerverse_id(index):
    """CV_%08d parallel to get_panTS_id (CancerVerse is CT-only — no masks yet)."""
    digits = str(index).upper().replace("CV_", "").replace("CV", "")
    return "CV_" + digits.zfill(8)

def get_folder_id(index):
    """Dataset-aware id: CV ids -> get_cancerverse_id, else get_panTS_id."""
    return get_cancerverse_id(index) if str(index).strip().upper().startswith("CV") else get_panTS_id(index)

def has_large_connected_component(slice_mask, threshold=8):
    """
    Check if there is a connected component larger than a threshold in a 2D mask.
    """
    labeled, num_features = label(slice_mask)
    sizes = np.bincount(labeled.ravel())
    sizes[0] = 0  # ignore background
    return np.any(sizes > threshold)


class NpzProcessor:
    def __init__(self, main_npz_path=None, clabel_path=None, organ_intensities=None):
        self._main_nifti_path = main_npz_path
        self._clabel_path = clabel_path
        self.number_max = 999999
        self._organ_intensities = organ_intensities
    
    def set_organ_intensities(self, organ_intensities):
        self._organ_intensities = organ_intensities

    @classmethod
    def from_clabel_path(cls, clabel_path):
        
        return cls(None, clabel_path)
    
    # not used
    def calculate_mean_hu_with_erosion(self, binary_mask, ct_array):
        """
        Calculate mean HU using erosion to avoid edge noise.
        """
        erosion_array = ndimage.binary_erosion(binary_mask, structure=Constants.STRUCTURING_ELEMENT)
        hu_values = ct_array[erosion_array > 0]

        if hu_values.size == 0:
            hu_values = ct_array[binary_mask > 0]

        if hu_values.size == 0:
            return 0

        return round(float(np.mean(hu_values)), Constants.DECIMAL_PRECISION_HU)
    
    
    def npz_to_nifti(self, id: int, combined_label=True, save=True, path=None):
        
        if combined_label and path is None:    
            dir_path = pathlib.Path(f"{Constants.PANTS_PATH}/mask_only/{get_panTS_id(id)}/{Constants.COMBINED_LABELS_FILENAME}")
        else:
            dir_path = pathlib.Path(path)   
            
        nifti_path = pathlib.Path(f"{Constants.PANTS_PATH}/image_only/{get_panTS_id(id)}/{Constants.MAIN_NIFTI_FILENAME}")
        nifti_dat = nib.load(nifti_path)

        arr = np.load(dir_path)["data"].astype(np.float32)
        img = nib.nifti1.Nifti1Image(arr, affine=nifti_dat.affine, header=nifti_dat.header)

        nib.save(img, dir_path.with_suffix(".nii.gz"))
            
            
    def combine_labels(self, id: int, keywords={"pancrea": "pancreas"}, save=True):   
        """
        Merge multiple label masks into one combined segmentation and re-index the labels.
        """
        organ_intensities = {}
            
        nifti_path = pathlib.Path(f"{Constants.PANTS_PATH}/image_only/{get_panTS_id(id)}/{Constants.MAIN_NIFTI_FILENAME}")
        nifti_dat = nib.load(nifti_path)
        
        dir_path = pathlib.Path(f"{Constants.PANTS_PATH}/mask_only/{get_panTS_id(id)}/segmentations")
        npz_files = list(dir_path.glob("*.npz"))
        
        combined_labels_img_data = None
        keyword_dict = {organ: None for organ in keywords.values()}

        for i, file in enumerate(npz_files):
            filename = file.name
            data = np.load(file)["data"]

            if combined_labels_img_data is None:
                combined_labels_img_data = np.ndarray(shape=data.shape, dtype=np.float64)
                
            matched = False
            for substring, organ in keywords.items():
                if substring in filename:
                    if keyword_dict[organ] is None:
                        keyword_dict[organ] = np.ndarray(shape=data.shape, dtype=np.float64)
                    scaled = data * np.float64(i + 1)
                    keyword_dict[organ] = np.maximum(keyword_dict[organ], scaled)
                    combined_labels_img_data = np.maximum(combined_labels_img_data, scaled)
                    organ_intensities[organ] = i + 1
                    matched = True
                    break
            
            if not matched:  # no keyword match, still add to combined
                scaled = data * np.float64(i + 1)
                combined_labels_img_data = np.maximum(combined_labels_img_data, scaled)
                organ_intensities[filename] = i + 1

        if save:
            # save each organ-specific file
            for organ, data in keyword_dict.items():
                if data is not None:
                    save_path = (
                        f"{Constants.PANTS_PATH}/mask_only/{get_panTS_id(id)}/segmentations/{organ}.nii.gz"
                    )
                    img = nib.Nifti1Image(data, affine=nifti_dat.affine, header=nifti_dat.header)
                    nib.save(img, save_path)
            
            # save combined labels
            if combined_labels_img_data is not None:
                save_path = (
                    f"{Constants.PANTS_PATH}/mask_only/{get_panTS_id(id)}/{Constants.COMBINED_LABELS_FILENAME}"
                )
                np.savez_compressed(save_path, data=combined_labels_img_data)

            # save organ intensities
            organ_save_path = (
                f"{Constants.PANTS_PATH}/mask_only/{get_panTS_id(id)}/{Constants.ORGAN_INTENSITIES_FILENAME}"
            )
            with open(organ_save_path, "w") as f:
                json.dump(organ_intensities, f)

        return combined_labels_img_data, organ_intensities

    
    def nifti_combine_labels(self, id: int, keywords: dict[str, str] = {"pancrea": "pancreas"}, save=True, organs: list[str]=[]):
        """
        Merge multiple NIfTI label masks into one combined segmentation and re-index the labels.
        """

        organ_intensities = {}

        # load main reference image (for affine/header)
        nifti_path = pathlib.Path(
            f"{Constants.PANTS_PATH}/image_only/{get_panTS_id(id)}/{Constants.MAIN_NIFTI_FILENAME}"
        )
        base_nifti = nib.load(nifti_path)

        # folder containing NIfTI segmentations
        dir_path = pathlib.Path(
            f"{Constants.PANTS_PATH}/mask_only/{get_panTS_id(id)}/segmentations"
        )

        if (len(organs) == 0):
            nii_files = list(dir_path.glob("*.nii*"))
        else: 
            nii_files = [f for f in dir_path.glob("*.nii*") if f.name.replace(".nii.gz","") in organs]
        if not nii_files:
            raise FileNotFoundError(f"No NIfTI label files found in {dir_path}")

        combined_labels = None
        keyword_dict = {organ: None for organ in keywords.values()}

        for i, file in enumerate(sorted(nii_files)):
            filename = file.name
            nii = nib.load(file)
            data = nii.get_fdata()

            if combined_labels is None:
                combined_labels = np.zeros_like(data, dtype=np.float64)

            matched = False
            # for substring, organ in keywords.items():
            #     if substring.lower() in filename.lower():
            #         if keyword_dict[organ] is None:
            #             keyword_dict[organ] = np.zeros_like(data, dtype=np.float64)
            #         scaled = data * float(i + 1)
            #         keyword_dict[organ] = np.maximum(keyword_dict[organ], scaled)
            #         combined_labels = np.maximum(combined_labels, scaled)
            #         organ_intensities[organ] = i + 1
            #         matched = True
            #         break

            if not matched:
                scaled = data * float(i + 1)
                combined_labels = np.maximum(combined_labels, scaled)
                organ_intensities[filename] = i + 1

        if save:
            # save each organ-specific mask
            for organ, data in keyword_dict.items():
                if data is not None:
                    save_path = (
                        f"{Constants.PANTS_PATH}/mask_only/{get_panTS_id(id)}/segmentations/{organ}.nii.gz"
                    )
                    img = nib.Nifti1Image(data, affine=base_nifti.affine, header=base_nifti.header)
                    nib.save(img, save_path)

            # save combined mask as NIfTI
            if combined_labels is not None:
                save_path = (
                    f"{Constants.PANTS_PATH}/mask_only/{get_panTS_id(id)}/{Constants.COMBINED_LABELS_NIFTI_FILENAME}"
                )
                img = nib.Nifti1Image(combined_labels, affine=base_nifti.affine, header=base_nifti.header)
                nib.save(img, save_path)

            # save organ intensity mapping
            organ_save_path = (
                f"{Constants.PANTS_PATH}/mask_only/{get_panTS_id(id)}/{Constants.ORGAN_INTENSITIES_FILENAME}"
            )
            with open(organ_save_path, "w") as f:
                json.dump(organ_intensities, f, indent=2)

        return combined_labels, organ_intensities, base_nifti.affine, base_nifti.header