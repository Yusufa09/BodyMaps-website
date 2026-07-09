// Local DICOM support: open a folder of .dcm files directly in the viewer, fully
// in-browser — nothing is uploaded, no backend involved. The Upload page stashes
// the picked File objects here (they can't ride through router state), the
// /dicom route consumes them. All Cornerstone imports are dynamic, inside
// loadLocalDicomSeries, so this module stays import-safe for jsdom tests and
// the DICOM loader bundle is only fetched when a folder is actually opened.

let _pendingFiles: File[] = [];

export function setLocalDicomFiles(files: File[]) {
	_pendingFiles = files;
}

// Non-clearing on purpose: React StrictMode double-runs effects in dev, and the
// second run must still see the files (it also lets "back → reopen" work).
export function getLocalDicomFiles(): File[] {
	return _pendingFiles;
}

// Filter obvious non-DICOM files up front (folders often carry DICOMDIR, jpgs,
// reports…). Files with no extension are common for DICOM, so keep those.
export function looksLikeDicom(file: File): boolean {
	const name = file.name.toLowerCase();
	if (name.startsWith(".")) return false;
	const dot = name.lastIndexOf(".");
	if (dot === -1) return true; // extensionless — typical for DICOM
	const ext = name.slice(dot + 1);
	return ext === "dcm" || ext === "dicom" || ext === "ima" || /^\d+$/.test(ext);
}

export type LocalDicomSeries = {
	imageIds: string[];
	seriesDescription: string;
	skippedFiles: number;
};

// init() registers the wadouri loaders, metadata provider, and decode-worker
// pool. Calling it more than once re-registers the worker ("already registered"
// warning) and can orphan in-flight worker messages — so guard it. Survives
// React StrictMode's double effect run and "back → reopen".
let _dicomInited = false;

/**
 * Register the files with the DICOM loader, read enough metadata to group them
 * by series, and return the imageIds of the largest series (a picked folder
 * often mixes scouts/dose reports with the actual CT stack). The volume loader
 * sorts the slices spatially, so imageId order here doesn't matter.
 */
export async function loadLocalDicomSeries(files: File[]): Promise<LocalDicomSeries> {
	const [{ metaData }, dicomLoader] = await Promise.all([
		import("@cornerstonejs/core"),
		import("@cornerstonejs/dicom-image-loader"),
	]);
	if (!_dicomInited) {
		dicomLoader.init();
		_dicomInited = true;
	}
	const wadouri = dicomLoader.wadouri;

	const candidates = files.filter(looksLikeDicom);
	const bySeries = new Map<string, { imageIds: string[]; description: string }>();
	let skippedFiles = files.length - candidates.length;

	for (const file of candidates) {
		const imageId = wadouri.fileManager.add(file);
		try {
			// Parse only the DICOM *header* — this populates the metadata provider so
			// the volume loader can compute geometry, without decoding pixels. The
			// volume loader decodes the slices itself when it builds the volume, so
			// decoding here would double the work AND flood the decode workers (which
			// is what made large series crawl / drop worker messages). This mirrors
			// wadouri.loadImage's own seam, minus the pixel decode.
			const { scheme, url } = wadouri.parseImageId(imageId);
			await wadouri.dataSetCacheManager.load(url, wadouri.getLoaderForScheme(scheme), imageId);
			const series = metaData.get("generalSeriesModule", imageId) as
				| { seriesInstanceUID?: string; seriesDescription?: string }
				| undefined;
			const uid = series?.seriesInstanceUID ?? "unknown-series";
			let entry = bySeries.get(uid);
			if (!entry) {
				entry = { imageIds: [], description: series?.seriesDescription ?? "" };
				bySeries.set(uid, entry);
			}
			entry.imageIds.push(imageId);
		} catch {
			skippedFiles++; // not parseable as DICOM — skip it
		}
	}

	let best: { imageIds: string[]; description: string } | null = null;
	for (const entry of bySeries.values()) {
		if (!best || entry.imageIds.length > best.imageIds.length) best = entry;
	}
	if (!best || best.imageIds.length < 2) {
		throw new Error(
			"No DICOM image series found in the selected files. Pick a folder containing one CT series (.dcm slices)."
		);
	}
	return {
		imageIds: best.imageIds,
		seriesDescription: best.description,
		skippedFiles,
	};
}
