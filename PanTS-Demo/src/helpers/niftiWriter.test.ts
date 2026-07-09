import { ungzip } from "pako";
import { describe, expect, it } from "vitest";
import { buildNifti, buildNiftiGzBlob, packLabelData } from "./niftiWriter";

// 2×2×2 identity-oriented labelmap, origin at LPS (10, 20, 30), 1.5 mm spacing.
const vol = {
	dimensions: [2, 2, 2],
	spacing: [1.5, 1.5, 2],
	origin: [10, 20, 30],
	direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
	data: [0, 1, 2, 3, 4, 5, 6, 7],
};

describe("packLabelData", () => {
	it("uses uint8 for small labels and uint16 when values exceed 255", () => {
		expect(packLabelData([0, 3, 255])).toMatchObject({ datatype: 2, bitpix: 8 });
		const wide = packLabelData([0, 300]);
		expect(wide).toMatchObject({ datatype: 512, bitpix: 16 });
		expect(wide.bytes.length).toBe(4); // two uint16 values
	});
});

describe("buildNifti", () => {
	it("writes a valid NIfTI-1 header with RAS sform and the label payload", () => {
		const bytes = buildNifti(vol);
		const view = new DataView(bytes.buffer);

		expect(view.getInt32(0, true)).toBe(348); // sizeof_hdr
		expect(view.getInt16(40, true)).toBe(3); // 3D
		expect(view.getInt16(42, true)).toBe(2);
		expect(view.getInt16(70, true)).toBe(2); // uint8
		expect(view.getFloat32(108, true)).toBe(352); // vox_offset
		expect(view.getInt16(254, true)).toBe(1); // sform_code
		// magic "n+1\0"
		expect(String.fromCharCode(bytes[344], bytes[345], bytes[346])).toBe("n+1");

		// sform: LPS→RAS negates x/y. srow_x = [-1.5, 0, 0, -10]
		expect(view.getFloat32(280, true)).toBeCloseTo(-1.5);
		expect(view.getFloat32(292, true)).toBeCloseTo(-10);
		// srow_y = [0, -1.5, 0, -20]
		expect(view.getFloat32(300, true)).toBeCloseTo(-1.5);
		expect(view.getFloat32(308, true)).toBeCloseTo(-20);
		// srow_z = [0, 0, 2, 30]
		expect(view.getFloat32(320, true)).toBeCloseTo(2);
		expect(view.getFloat32(324, true)).toBeCloseTo(30);

		// payload starts at 352 and matches the labels
		expect(Array.from(bytes.slice(352))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
	});

	it("rejects data that doesn't match the dimensions", () => {
		expect(() => buildNifti({ ...vol, data: [1, 2, 3] })).toThrow(/doesn't match/);
	});
});

describe("buildNiftiGzBlob", () => {
	it("round-trips through gzip", async () => {
		const blob = buildNiftiGzBlob(vol);
		// jsdom's Blob has no arrayBuffer(); go through FileReader instead.
		const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as ArrayBuffer);
			reader.onerror = () => reject(reader.error);
			reader.readAsArrayBuffer(blob);
		});
		const raw = ungzip(new Uint8Array(buf));
		expect(Array.from(raw.slice(352))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
	});
});
