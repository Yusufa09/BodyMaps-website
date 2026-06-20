// Warms the code-split viewer chunk (VisualizationPage + NiiVue/Cornerstone) so the
// first case-open doesn't pay the ~1.25 MB-gzip JS download at click time. This loads
// ONLY the JS — never the CT volume — so it's safe to call eagerly (no bandwidth risk
// on shared JHU infra). The dynamic import resolves to the same module App.tsx lazy-
// loads, so Rollup/Vite serve the identical cached chunk.
let started = false;

export function prefetchViewer(): void {
	if (started) return;
	started = true;
	// Fire-and-forget; ignore failures (the real navigation will retry the import).
	import("../routes/VisualizationPage").catch(() => {
		started = false; // allow a later retry if the prefetch failed
	});
}
