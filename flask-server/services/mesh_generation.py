from pathlib import Path
import json
import re
import dotenv
import os

import nibabel as nib
import numpy as np
from skimage import measure
import trimesh

from constants import Constants
from utils import *

dotenv.load_dotenv()

LABELS = {
	1: {"key": "adrenal_gland_left", "name": "Left Adrenal Gland"},
	2: {"key": "adrenal_gland_right", "name": "Right Adrenal Gland"},
    3: {"key": "aorta", "name": "Aorta"},
    4: {"key": "bladder", "name": "Bladder"},
    5: {"key": "celiac_artery", "name": "Celiac Artery"},
    6: {"key": "colon", "name": "Colon"},
    7: {"key": "common_bile_duct", "name": "Common Bile Duct"},
    8: {"key": "duodenum", "name": "Duodenum"},
    9: {"key": "femur_left", "name": "Left Femur"},
    10: {"key": "femur_right", "name": "Right Femur"},
    11: {"key": "gall_bladder", "name": "Gall Bladder"},
    12: {"key": "kidney_left", "name": "Left Kidney"},
    13: {"key": "kidney_right", "name": "Right Kidney"},
    14: {"key": "liver", "name": "Liver"},
    15: {"key": "lung_left", "name": "Left Lung"},
    16: {"key": "lung_right", "name": "Right Lung"},
    17: {"key": "pancreas", "name": "Pancreas"},
    18: {"key": "pancreas_body", "name": "Pancreas Body"},
    19: {"key": "pancreas_head", "name": "Pancreas Head"},
    20: {"key": "pancreas_tail", "name": "Pancreas Tail"},
    21: {"key": "pancreatic_duct", "name": "Pancreatic Duct"},
    22: {"key": "pancreatic_lesion", "name": "Pancreatic Lesion"},
    23: {"key": "postcava", "name": "Postcava"},
    24: {"key": "prostate", "name": "Prostate"},
    25: {"key": "spleen", "name": "Spleen"},
    26: {"key": "stomach", "name": "Stomach"},
    27: {"key": "superior_mesenteric_artery", "name": "Superior Mesenteric Artery"},    
    28: {"key": "veins", "name": "Veins"},
    29: {"key": "intestine", "name": "Intestine"},
    30: {"key": "renal_vein_left", "name": "Left Renal Vein"},
    31: {"key": "renal_vein_right", "name": "Right Renal Vein"},
    32: {"key": "cbd_stent", "name": "Common Bile Duct Stent"},
}


def safe_filename(s: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_\\-]+", "_", s).lower()


def nifti_world_to_three(world_xyz: np.ndarray) -> np.ndarray:
    x = world_xyz[:, 0]
    y = world_xyz[:, 2]
    z = -world_xyz[:, 1]
    return np.column_stack([x, y, z])


def compute_global_center(shape, affine: np.ndarray) -> np.ndarray:
    nx, ny, nz = shape[:3]

    corners_ijk = np.array(
        [
            [0, 0, 0],
            [0, 0, nz - 1],
            [0, ny - 1, 0],
            [0, ny - 1, nz - 1],
            [nx - 1, 0, 0],
            [nx - 1, 0, nz - 1],
            [nx - 1, ny - 1, 0],
            [nx - 1, ny - 1, nz - 1],
        ],
        dtype=float,
    )

    world = nib.affines.apply_affine(affine, corners_ijk)
    three = nifti_world_to_three(world)

    return (three.min(axis=0) + three.max(axis=0)) / 2.0

def load_clean_label_data(label_nifti_path: str):
    img = nib.load(str(label_nifti_path))
    raw = np.asanyarray(img.dataobj)

    if np.issubdtype(raw.dtype, np.integer):
        data = raw.astype(np.int32, copy=False)
        return img, data

    rounded = np.rint(raw)
    max_err = float(np.nanmax(np.abs(raw - rounded)))

    if max_err > 1e-3:
        raise ValueError(
            f"Labelmap has non-integer values. Max error from integer: {max_err}. "
    )

    data = rounded.astype(np.int32)
    return img, data


def mesh_to_glb_bytes(mesh: trimesh.Trimesh) -> bytes:
    exported = mesh.export(file_type="glb")

    if isinstance(exported, bytes):
        return exported

    if isinstance(exported, str):
        return exported.encode("utf-8")

    raise TypeError(f"Unexpected GLB export type: {type(exported)}")


def generate_organ_glb_bytes(
    organ_key: str,
    label_nifti_path: str,
) -> bytes:


    img, data = load_clean_label_data(label_nifti_path)

    label_id = None
    for key, meta in LABELS.items():
        if meta["key"] == organ_key:
            label_id = key
            break

    if label_id is None:
        raise ValueError(f"Unknown organ key: {organ_key}")
    
    mask = data == label_id

    if not mask.any():
        raise ValueError(f"Organ {organ_key} with label {label_id} has no voxels.")

    global_center = compute_global_center(data.shape, img.affine)

    padded = np.pad(mask.astype(np.uint8), pad_width=1, mode="constant")

    verts_ijk, faces, normals, values = measure.marching_cubes(
        padded,
        level=0.5,
        step_size=1,
        allow_degenerate=False,
    )

    verts_ijk -= 1.0

    verts_world = nib.affines.apply_affine(img.affine, verts_ijk)
    verts_three = nifti_world_to_three(verts_world)
    verts_three -= global_center

    mesh = trimesh.Trimesh(
        vertices=verts_three,
        faces=faces,
        process=False,
    )

    # Trimesh cleanup, using the newer API.
    if hasattr(mesh, "unique_faces"):
        mesh.update_faces(mesh.unique_faces())

    if hasattr(mesh, "nondegenerate_faces"):
        mesh.update_faces(mesh.nondegenerate_faces())

    mesh.remove_unreferenced_vertices()
    mesh.merge_vertices()

    return mesh_to_glb_bytes(mesh)


def generate_mesh_manifest(
    case_id: str,
    label_nifti_path: str,
) -> dict:
    img, data = load_clean_label_data(label_nifti_path)

    present_labels = set(np.unique(data).astype(int).tolist())
    # nz = np.where(data.shape != 0)
    # print(nz.shape)
    global_center = compute_global_center(data.shape, img.affine)

    organs = []

    for key, meta in LABELS.items():
        label_id = key

        if label_id not in present_labels:
            continue
        
        filename = f"{safe_filename(meta['key'])}.glb"
        # print('key', key)

        organs.append(
            {
                "id": key,
                "key": meta["key"],
                "name": meta["name"],
                "url": f"{os.getenv('API_ORIGIN', 'http://localhost:5001')}/api/cases/{case_id}/meshes/{filename}",
            }
        )

    return {
        "caseId": case_id,
        "affine": img.affine.tolist(),
        "center": global_center.tolist(),
        "organs": organs,
    }


