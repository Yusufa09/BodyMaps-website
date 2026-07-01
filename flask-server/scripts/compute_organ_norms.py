#!/usr/bin/env python3
"""
Offline batch job: build population reference distributions of per-organ volumes so the
viewer's "Organ Statistics" panel can show where a case sits in the dataset
(e.g. "liver volume = p72 for 60–69 y/o males"). Meant to run on the JHU server, which
has the masks + metadata — CPU/disk only, no new infrastructure and no new API endpoints.

For every case with a segmentation it computes per-organ volume (cm³) via the SAME code
path the live /api/mask-data uses (get_mask_data_internal), then buckets the volumes by
sex × age-decade and writes percentile breakpoints per (organ, bucket) to a compact JSON.
The viewer fetches that JSON statically and interpolates a percentile client-side
(see PanTS-Demo/src/helpers/organNorms.ts).

Each case is counted into several overlapping buckets so the viewer can fall back from a
specific group to a broader one when a bucket is small:
    "M|60-69"  "M|ALL"  "ALL|60-69"  "ALL|ALL"

Output (default): ../PanTS-Demo/public/organ_norms.json — shipped by `npm run build` and
served at /organ_norms.json. Fully additive: if the file is absent the panel simply omits
the percentile column (degrades exactly like it does today without the dataset volumes).

Usage (on the server, BEFORE `npm run build`):
    cd flask-server && venv/bin/python scripts/compute_organ_norms.py
    venv/bin/python scripts/compute_organ_norms.py --limit 50      # quick trial
    venv/bin/python scripts/compute_organ_norms.py --min-n 30      # require larger groups
"""
import argparse
import datetime
import glob
import json
import math
import os
import re
import sys
import time
from collections import defaultdict

import numpy as np
import pandas as pd

# Import the app's helpers (PANTS_PATH, the metric code path) from the flask-server root.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from constants import Constants  # noqa: E402
from api.utils import get_mask_data_internal  # noqa: E402

# The number get_mask_data_internal uses to flag an organ whose metric is unreliable
# (mask touches the volume edge / clipped). Mirrors NiftiProcessor.number_max.
INVALID_METRIC = 999999

DEFAULT_GRID = [0, 5, 10, 25, 50, 75, 90, 95, 100]


def age_to_bin(age):
    """Decade label matching organNorms.ts ageToBin; >=90 -> "90-99"; bad -> "UNKNOWN"."""
    try:
        a = float(age)
    except (TypeError, ValueError):
        return "UNKNOWN"
    if math.isnan(a) or a < 0:
        return "UNKNOWN"
    lo = min(int(a // 10) * 10, 90)
    return f"{lo}-{lo + 9}"


def normalize_sex(sex):
    """'M'/'F' for a known sex, else None (case still counts into the all-sex buckets)."""
    s = str(sex).strip().upper() if sex is not None else ""
    return s if s in ("M", "F") else None


def bucket_keys(sex, age):
    """Overlapping bucket keys a case contributes to (specific + fallbacks)."""
    s = normalize_sex(sex)
    bin_ = age_to_bin(age)
    keys = [f"ALL|{bin_}", "ALL|ALL"]
    if s:
        keys += [f"{s}|{bin_}", f"{s}|ALL"]
    return keys


def numeric_id_from_dir(dirname):
    """'PanTS_00000123' -> 123; returns None if it doesn't look like a case dir."""
    m = re.search(r"(\d+)", os.path.basename(dirname))
    return int(m.group(1)) if m else None


def load_demographics():
    """Map PanTS ID (e.g. 'PanTS_00000001') -> (sex, age) from the dataset metadata."""
    meta_path = f"{Constants.PANTS_PATH}/metadata.xlsx"
    if not os.path.exists(meta_path):
        sys.exit(f"metadata not found: {meta_path}")
    df = pd.read_excel(meta_path)
    id_col = next((c for c in df.columns if str(c).strip().lower() in ("pants id", "pants_id")), None)
    sex_col = next((c for c in df.columns if str(c).strip().lower() == "sex"), None)
    age_col = next((c for c in df.columns if str(c).strip().lower() == "age"), None)
    if id_col is None:
        sys.exit(f"could not find a PanTS ID column in {meta_path}")
    demo = {}
    for _, row in df.iterrows():
        pid = str(row[id_col]).strip()
        sex = row[sex_col] if sex_col else None
        age = row[age_col] if age_col else None
        demo[pid] = (sex, age)
    return demo


def main():
    ap = argparse.ArgumentParser(description="Build per-organ volume norms for the viewer.")
    default_out = os.path.normpath(
        os.path.join(os.path.dirname(__file__), "..", "..", "PanTS-Demo", "public", "organ_norms.json")
    )
    ap.add_argument("--out", default=default_out, help="output JSON path")
    ap.add_argument("--limit", type=int, default=0, help="process at most N cases (0 = all)")
    ap.add_argument("--min-n", type=int, default=20, help="smallest bucket the viewer will trust")
    ap.add_argument("--grid", default=",".join(map(str, DEFAULT_GRID)),
                    help="comma-separated percentile levels to store")
    args = ap.parse_args()

    if not Constants.PANTS_PATH:
        sys.exit("PANTS_PATH not set — check flask-server/.env")
    grid = [float(x) for x in args.grid.split(",") if x.strip() != ""]
    if grid != sorted(grid) or grid[0] < 0 or grid[-1] > 100:
        sys.exit("--grid must be ascending values within 0..100")

    demo = load_demographics()

    mask_dirs = sorted(glob.glob(f"{Constants.PANTS_PATH}/mask_only/*"))
    mask_dirs = [d for d in mask_dirs if os.path.isdir(d)]
    if args.limit:
        mask_dirs = mask_dirs[: args.limit]
    print(f"Found {len(mask_dirs)} segmented cases under {Constants.PANTS_PATH}/mask_only")

    # organ -> bucket_key -> list of volumes (cm³)
    samples = defaultdict(lambda: defaultdict(list))
    counts = {"ok": 0, "no_metrics": 0, "err": 0}
    t0 = time.time()

    for i, d in enumerate(mask_dirs, 1):
        pid = os.path.basename(d)
        num_id = numeric_id_from_dir(d)
        if num_id is None:
            counts["err"] += 1
            continue
        try:
            result = get_mask_data_internal(num_id)
            metrics = result.get("organ_metrics") if isinstance(result, dict) else None
        except Exception as e:  # never let one bad case abort the batch
            print(f"  [err] {pid}: {e}")
            counts["err"] += 1
            continue
        if not metrics:
            counts["no_metrics"] += 1
            continue

        sex, age = demo.get(pid, (None, None))
        keys = bucket_keys(sex, age)
        added = False
        for m in metrics:
            organ = m.get("organ_name")
            vol = m.get("volume_cm3")
            if not organ or vol is None or vol == INVALID_METRIC:
                continue
            try:
                vol = float(vol)
            except (TypeError, ValueError):
                continue
            if vol <= 0 or math.isnan(vol):
                continue
            for k in keys:
                samples[organ][k].append(vol)
            added = True
        counts["ok" if added else "no_metrics"] += 1

        if i % 25 == 0 or i == len(mask_dirs):
            print(f"  {i}/{len(mask_dirs)}  ok={counts['ok']} "
                  f"no_metrics={counts['no_metrics']} err={counts['err']}  "
                  f"({time.time() - t0:.0f}s)")

    # Reduce each bucket to percentile breakpoints. Drop buckets below --min-n (the viewer
    # would skip them and fall back anyway) but always keep "ALL|ALL" as a last resort.
    organs = {}
    for organ, buckets in samples.items():
        out_buckets = {}
        for key, vols in buckets.items():
            n = len(vols)
            if n < args.min_n and key != "ALL|ALL":
                continue
            arr = np.array(vols, dtype=float)
            q = [round(float(np.percentile(arr, p)), 2) for p in grid]
            out_buckets[key] = {"n": n, "q": q}
        if out_buckets:
            organs[organ] = out_buckets

    payload = {
        "version": 1,
        "generated_at": datetime.datetime.utcnow().isoformat() + "Z",
        "case_count": counts["ok"],
        "min_n": args.min_n,
        "percentile_grid": grid,
        "organs": organs,
    }

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    size_kb = os.path.getsize(args.out) / 1024
    print(f"Done: {counts}")
    print(f"Wrote {len(organs)} organs to {args.out} ({size_kb:.0f} KB)")
    print("Remember to `cd PanTS-Demo && npm run build` so it ships as /organ_norms.json")


if __name__ == "__main__":
    main()
