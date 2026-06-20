#!/usr/bin/env python3
"""
Offline batch job: generate low-resolution copies of the dataset volumes so the web
viewer can load a small version first (instant interaction) and fetch full resolution
only on demand ("HD"). Meant to run on the JHU server, which has the data + the
hardware — it's CPU/disk only, no new infrastructure.

Per case it writes, next to the originals:
    ct.nii.gz              -> ct_lowres.nii.gz               (linear, order=1)
    combined_labels.nii.gz -> combined_labels_lowres.nii.gz  (nearest, order=0)

CT and segmentation are downsampled by the SAME --factor so they stay geometrically
aligned (the viewer overlays them) — at low res the relationship is identical to full
res, so the overlay can't break. Both files are written together per case (or neither),
so the API never ends up serving a low-res CT against a full-res mask.

Fully additive + reversible: if the *_lowres.nii.gz files are absent, the API serves
the originals exactly as before. Delete the low-res files to revert.

Usage (on the server):
    cd flask-server && venv/bin/python scripts/make_lowres.py --factor 2
    # quick trial run:
    venv/bin/python scripts/make_lowres.py --factor 2 --limit 5
Idempotent: skips cases that already have low-res files unless --overwrite.
"""
import argparse
import glob
import os
import sys
import time

import nibabel as nib
import numpy as np
from scipy.ndimage import zoom

# Import the app's constants (PANTS_PATH, filenames) from the flask-server root.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from constants import Constants  # noqa: E402

CT_NAME = "ct.nii.gz"
SEG_NAME = "combined_labels.nii.gz"
CT_LOW = "ct_lowres.nii.gz"
SEG_LOW = "combined_labels_lowres.nii.gz"


def _downsample(img, factor, order):
    """Return (data, affine) downsampled by `factor` per axis, preserving world extent."""
    data = img.get_fdata()
    out = zoom(data, 1.0 / factor, order=order)
    new_affine = img.affine.copy()
    # voxels are now `factor`x larger, so scale the voxel->world matrix to match.
    new_affine[:3, :3] = img.affine[:3, :3] * factor
    return out, new_affine


def _seg_path_for(ct_path):
    """Map .../ImageTr/<id>/ct.nii.gz -> .../LabelTr/<id>/combined_labels.nii.gz."""
    p = ct_path.replace(f"{os.sep}ImageTr{os.sep}", f"{os.sep}LabelTr{os.sep}")
    p = p.replace(f"{os.sep}ImageTe{os.sep}", f"{os.sep}LabelTe{os.sep}")
    return p.replace(CT_NAME, SEG_NAME)


def _process_case(ct_path, factor, overwrite):
    seg_path = _seg_path_for(ct_path)
    if not os.path.exists(seg_path):
        return "no_seg"  # skip entirely so we never pair low CT with full mask

    ct_low = os.path.join(os.path.dirname(ct_path), CT_LOW)
    seg_low = os.path.join(os.path.dirname(seg_path), SEG_LOW)
    if os.path.exists(ct_low) and os.path.exists(seg_low) and not overwrite:
        return "skip"

    # CT: linear interpolation, keep int16 Hounsfield units.
    ct_img = nib.load(ct_path)
    ct_data, ct_aff = _downsample(ct_img, factor, order=1)
    ct_out = nib.Nifti1Image(np.rint(ct_data).astype(np.int16), ct_aff)
    ct_out.set_data_dtype(np.int16)

    # Segmentation: nearest-neighbour so label ids are preserved exactly.
    seg_img = nib.load(seg_path)
    seg_data, seg_aff = _downsample(seg_img, factor, order=0)
    seg_out = nib.Nifti1Image(seg_data.astype(np.uint8), seg_aff)
    seg_out.set_data_dtype(np.uint8)

    nib.save(ct_out, ct_low)
    nib.save(seg_out, seg_low)
    return "ok"


def main():
    ap = argparse.ArgumentParser(description="Generate low-res CT + seg copies.")
    ap.add_argument("--factor", type=float, default=2.0, help="downsample factor per axis (>=1)")
    ap.add_argument("--overwrite", action="store_true", help="regenerate even if low-res exists")
    ap.add_argument("--limit", type=int, default=0, help="process at most N cases (0 = all)")
    args = ap.parse_args()

    if not Constants.PANTS_PATH:
        sys.exit("PANTS_PATH not set — check flask-server/.env")
    if args.factor < 1:
        sys.exit("--factor must be >= 1")

    root = os.path.join(Constants.PANTS_PATH, "data")
    ct_paths = []
    for sub in ("ImageTr", "ImageTe"):
        ct_paths += sorted(glob.glob(os.path.join(root, sub, "*", CT_NAME)))
    if args.limit:
        ct_paths = ct_paths[: args.limit]

    print(f"Found {len(ct_paths)} CT volumes under {root} (factor={args.factor})")
    counts = {"ok": 0, "skip": 0, "no_seg": 0, "err": 0}
    t0 = time.time()
    for i, ct in enumerate(ct_paths, 1):
        try:
            result = _process_case(ct, args.factor, args.overwrite)
        except Exception as e:  # never let one bad file abort the batch
            result = "err"
            print(f"  [err] {ct}: {e}")
        counts[result] += 1
        if i % 25 == 0 or i == len(ct_paths):
            print(f"  {i}/{len(ct_paths)}  ok={counts['ok']} skip={counts['skip']} "
                  f"no_seg={counts['no_seg']} err={counts['err']}  ({time.time()-t0:.0f}s)")

    print(f"Done: {counts}")


if __name__ == "__main__":
    main()
