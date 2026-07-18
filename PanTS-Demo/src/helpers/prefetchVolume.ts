// Warms the low-res CT for a case on card hover so clicking pays only decode + render,
// not the download. Pairs with prefetchViewer.ts (which warms the JS chunk).
//
// The volume responses are immutable (7-day Cache-Control), so a prefetched CT is reused
// straight from the browser cache on click. Guardrails keep this safe on shared JHU infra:
//   - CT only (never the mask) to halve bandwidth
//   - dedupe: each case is fetched at most once per session
//   - a global concurrency cap so hovering across the grid can't stampede the backend
//     (this cap is also why it's safe before the low-res batch exists — worst case is a
//      couple of full-res CTs in flight, not the whole grid)
// Callers should debounce with a short hover dwell (see Preview.tsx) so a quick pass-over
// doesn't trigger a fetch.
import { API_BASE } from "./constants";
import type { CaseId } from "./search";

const MAX_CONCURRENT = 2;
const requested = new Set<CaseId>();
const queue: CaseId[] = [];
let inFlight = 0;

function pump(): void {
	while (inFlight < MAX_CONCURRENT && queue.length > 0) {
		const id = queue.shift()!;
		inFlight += 1;
		// low-res by default; the server serves full res only if low-res isn't generated yet.
		fetch(`${API_BASE}/api/get-main-nifti/${id}.nii.gz?res=low`)
			// Drain the body so the response is fully received and cached, then let it GC.
			.then((r) => (r.ok ? r.blob() : null))
			.catch(() => null)
			.finally(() => {
				inFlight -= 1;
				pump();
			});
	}
}

/** Queue a low-res CT prefetch for a dataset case (idempotent, bandwidth-bounded).
 *  Accepts a PanTS number or a CancerVerse string id (e.g. "CV_00000001"). */
export function prefetchVolume(id: CaseId): void {
	if (!id || requested.has(id)) return; // 0 / "" = no usable id
	requested.add(id);
	queue.push(id);
	pump();
}
