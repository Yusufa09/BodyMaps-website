// Shared CT/segmentation source resolution + background prefetch for the comparison
// viewer. The data /compare page warms these (viewer chunk + both cases' volumes) as soon
// as it loads, so opening the live side-by-side viewer is fast. Uses the exact same
// resolution the viewer uses, so the prefetched URLs match and hit the browser cache.
import { API_BASE } from "./constants";
import { getPanTSId } from "./utils";

// Local volume+mask first (fast, low-res); HuggingFace mirror fallback — same sources the
// single viewer uses, so coverage is identical.
export async function resolveSources(id: string): Promise<{ ct: string; seg: string }> {
	const localCt = `${API_BASE}/api/get-main-nifti/${id}`;
	const localSeg = `${API_BASE}/api/get-segmentations/${id}`;
	const p = getPanTSId(id);
	const hfCt = `https://huggingface.co/datasets/BodyMaps/iPanTSMini/resolve/main/image_only/${p}/ct.nii.gz?download=true`;
	const hfSeg = `https://huggingface.co/datasets/BodyMaps/iPanTSMini/resolve/main/mask_only/${p}/combined_labels.nii.gz?download=true`;
	const ok = await fetch(localCt, { method: "HEAD" })
		.then((r) => r.ok)
		.catch(() => false);
	return ok ? { ct: `${localCt}?res=low`, seg: `${localSeg}?res=low` } : { ct: hfCt, seg: hfSeg };
}

// Respect the user's data budget: skip prefetch under Save-Data or on very slow (2G)
// connections — the same restraint the browser applies to native prefetch. These volumes
// are large and only *maybe* used, so honouring this matters.
function prefetchAllowed(): boolean {
	if (typeof navigator === "undefined") return false;
	const c = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
	if (c?.saveData) return false;
	if (typeof c?.effectiveType === "string" && c.effectiveType.includes("2g")) return false;
	return true;
}

// Warm the lazily-loaded viewer chunk so navigating to it doesn't wait on a JS download.
export function prefetchCompareViewerChunk(): void {
	// Skip under vitest — importing the viewer chunk pulls the WebGL stack jsdom can't load.
	if (typeof process !== "undefined" && process.env?.VITEST) return;
	if (!prefetchAllowed()) return;
	import("../routes/CompareViewerPage").catch(() => {});
}

// Kick off background downloads of both cases' CT + segmentation volumes so the viewer's
// loader hits a warm browser cache. Fire-and-forget, low priority, deduped per id.
const warmed = new Set<string>();
export function prefetchCompareVolumes(ids: string[]): void {
	if (!prefetchAllowed()) return;
	for (const id of ids) {
		if (!id.trim() || warmed.has(id)) continue;
		warmed.add(id);
		resolveSources(id)
			.then(({ ct, seg }) => {
				const opts = { priority: "low" } as unknown as RequestInit;
				fetch(ct, opts).catch(() => {});
				fetch(seg, opts).catch(() => {});
			})
			.catch(() => {});
	}
}
