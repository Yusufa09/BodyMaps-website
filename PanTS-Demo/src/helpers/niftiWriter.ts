// Minimal NIfTI-1 writer for exporting an edited segmentation labelmap. Pure
// byte-building (no DOM, no Cornerstone) so it's unit-testable; gzip via pako.
//
// Geometry: Cornerstone volumes carry LPS world coordinates (DICOM convention),
// with `direction` as three contiguous axis vectors (i, j, k) and `origin` at
// voxel (0,0,0). NIfTI's sform expects RAS, so the x and y world components are
// negated. The affine columns are direction-axis × spacing; translation is the
// origin. sform_code=1 (scanner), qform_code=0.

import { gzip } from "pako";
import type { LabelmapExport } from "./CornerstoneNifti2";

const HEADER_BYTES = 348;
const VOX_OFFSET = 352; // header + 4-byte extension flag

// NIfTI datatype codes for the label types we emit.
const DT_UINT8 = 2;
const DT_UINT16 = 512;

// Labels are small integers; store in the narrowest type that fits.
export function packLabelData(data: ArrayLike<number>): {
	bytes: Uint8Array;
	datatype: number;
	bitpix: number;
} {
	let max = 0;
	for (let i = 0; i < data.length; i++) {
		const v = data[i];
		if (v > max) max = v;
	}
	if (max <= 255) {
		const out = new Uint8Array(data.length);
		for (let i = 0; i < data.length; i++) out[i] = data[i];
		return { bytes: out, datatype: DT_UINT8, bitpix: 8 };
	}
	const out16 = new Uint16Array(data.length);
	for (let i = 0; i < data.length; i++) out16[i] = data[i];
	return { bytes: new Uint8Array(out16.buffer), datatype: DT_UINT16, bitpix: 16 };
}

/** Uncompressed .nii bytes for a labelmap volume. */
export function buildNifti(vol: LabelmapExport): Uint8Array {
	const [nx, ny, nz] = vol.dimensions;
	const [sx, sy, sz] = vol.spacing;
	const { bytes, datatype, bitpix } = packLabelData(vol.data);
	if (bytes.length !== nx * ny * nz * (bitpix / 8)) {
		throw new Error(
			`labelmap size ${bytes.length} doesn't match dimensions ${nx}×${ny}×${nz}`
		);
	}

	const buffer = new ArrayBuffer(VOX_OFFSET + bytes.length);
	const view = new DataView(buffer);
	const LE = true;

	view.setInt32(0, HEADER_BYTES, LE); // sizeof_hdr
	// dim[8]
	view.setInt16(40, 3, LE);
	view.setInt16(42, nx, LE);
	view.setInt16(44, ny, LE);
	view.setInt16(46, nz, LE);
	view.setInt16(48, 1, LE);
	view.setInt16(50, 1, LE);
	view.setInt16(52, 1, LE);
	view.setInt16(54, 1, LE);
	view.setInt16(70, datatype, LE);
	view.setInt16(72, bitpix, LE);
	// pixdim
	view.setFloat32(76, 1, LE);
	view.setFloat32(80, sx, LE);
	view.setFloat32(84, sy, LE);
	view.setFloat32(88, sz, LE);
	view.setFloat32(108, VOX_OFFSET, LE); // vox_offset
	view.setFloat32(112, 1, LE); // scl_slope
	view.setFloat32(116, 0, LE); // scl_inter
	view.setInt8(123, 2); // xyzt_units: mm
	view.setInt16(252, 0, LE); // qform_code
	view.setInt16(254, 1, LE); // sform_code: scanner

	// sform rows. LPS→RAS flips the sign of the world x and y components.
	const d = vol.direction;
	const o = vol.origin;
	const flip = [-1, -1, 1];
	for (let r = 0; r < 3; r++) {
		const base = 280 + r * 16;
		view.setFloat32(base, d[0 + r] * sx * flip[r], LE); // i-axis contribution
		view.setFloat32(base + 4, d[3 + r] * sy * flip[r], LE); // j-axis
		view.setFloat32(base + 8, d[6 + r] * sz * flip[r], LE); // k-axis
		view.setFloat32(base + 12, o[r] * flip[r], LE);
	}

	// magic "n+1\0"
	view.setUint8(344, 0x6e);
	view.setUint8(345, 0x2b);
	view.setUint8(346, 0x31);
	view.setUint8(347, 0x00);
	// bytes 348–351 stay zero: no header extensions.

	new Uint8Array(buffer, VOX_OFFSET).set(bytes);
	return new Uint8Array(buffer);
}

/** Gzipped .nii.gz blob, ready to download. */
export function buildNiftiGzBlob(vol: LabelmapExport): Blob {
	const nii = buildNifti(vol);
	const gz = gzip(nii);
	// Copy into a fresh ArrayBuffer-backed array — Blob's type rejects SharedArrayBuffer views.
	return new Blob([new Uint8Array(gz)], { type: "application/gzip" });
}
