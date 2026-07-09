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

/**
 * Register the files with the DICOM loader, read enough metadata to group them
 * by series, and return the imageIds of the largest series (a picked folder
 * often mixes scouts/dose reports with the actual CT stack). The volume loader
 * sorts the slices spatially, so imageId order here doesn't matter.
 */
export async function loadLocalDicomSeries(files: File[]): Promise<LocalDicomSeries> {
	const [{ imageLoader, metaData }, dicomLoader] = await Promise.all([
		import("@cornerstonejs/core"),
		import("@cornerstonejs/dicom-image-loader"),
	]);
	dicomLoader.init(); // registers the wadouri/dicomfile loaders + metadata provider

	const candidates = files.filter(looksLikeDicom);
	const bySeries = new Map<string, { imageIds: string[]; description: string }>();
	let skippedFiles = files.length - candidates.length;

	for (const file of candidates) {
		const imageId = dicomLoader.wadouri.fileManager.add(file);
		try {
			// Loading once parses the file and populates the metadata provider (the
			// volume loader needs geometry up front; images stay cached for reuse).
			await imageLoader.loadAndCacheImage(imageId);
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
