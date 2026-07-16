// Local NIfTI support: view a single .nii/.nii.gz file picked on the Upload page in a
// full-page viewer, entirely in-browser — nothing is uploaded. The Upload page stashes
// the File here (File objects can't ride through router state); the /local-nifti route
// consumes it. Mirrors dicomLocal.ts for the DICOM case.

let _pendingFile: File | null = null;

export function setLocalNiftiFile(file: File) {
	_pendingFile = file;
}

// Non-clearing on purpose: React StrictMode double-runs effects in dev, and the second
// run (and "back → reopen") must still see the file.
export function getLocalNiftiFile(): File | null {
	return _pendingFile;
}

// Cornerstone's NIfTI metadata loader decides gzip from the URL *extension*
// (`pathname.endsWith('.gz')`), but a blob: URL has none — so a .nii.gz would never be
// decompressed and would fail to parse. Decompress here by magic bytes and hand back a
// blob URL of the raw .nii bytes, which the loader then reads as uncompressed. Returns
// null when no file is stashed (deep link / reload).
export async function loadLocalNiftiAsRawBlobUrl(): Promise<string | null> {
	if (!_pendingFile) return null;
	const buf = await _pendingFile.arrayBuffer();
	const bytes = new Uint8Array(buf);
	const isGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
	if (!isGzip) return URL.createObjectURL(new Blob([buf]));
	const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
	const raw = await new Response(stream).arrayBuffer();
	return URL.createObjectURL(new Blob([raw]));
}
