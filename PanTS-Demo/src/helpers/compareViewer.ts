// Isolated dual CT viewer for side-by-side case comparison. Deliberately does NOT reuse
// the single-case helper (CornerstoneNifti2), which is built on module-level singletons —
// this keeps its own rendering engine / tool groups / viewport ids so it can't regress the
// main viewer.
//
// Each case gets a 3-plane MPR (axial/sagittal/coronal) with its own crosshair navigation
// and segmentation overlay. A "Link" syncs proportional slice position across the two
// cases' axial views (cross-patient → proportional depth, not shared world coords). CT
// window presets apply to both cases at once.
import {
	Enums,
	RenderingEngine,
	type Types,
	eventTarget,
	imageLoader,
	init as coreInit,
	setVolumesForViewports,
	utilities as csUtils,
	volumeLoader,
} from "@cornerstonejs/core";
import {
	cornerstoneNiftiImageLoader,
	createNiftiImageIdsAndCacheMetadata,
	init as niftiInit,
} from "@cornerstonejs/nifti-volume-loader";
import * as tools from "@cornerstonejs/tools";
import { SegmentationRepresentations } from "@cornerstonejs/tools/enums";
import type { Color, ColorLUT } from "@cornerstonejs/core/types";
import { segmentation_category_colors } from "./constants";

const ENGINE_ID = "cmp_engine";
// Per-case: 3 viewports + a tool group + a segmentation id.
const A = { ax: "cmp_a_ax", sag: "cmp_a_sag", cor: "cmp_a_cor", tg: "cmp_tg_a", seg: "cmp_seg_a" };
const B = { ax: "cmp_b_ax", sag: "cmp_b_sag", cor: "cmp_b_cor", tg: "cmp_tg_b", seg: "cmp_seg_b" };

const SEG_CONFIG = {
	fillAlpha: 0.6,
	fillAlphaInactive: 0.6,
	outlineOpacity: 1,
	outlineWidth: 1,
	renderOutline: false,
	outlineOpacityInactive: 0,
};

// Reference-line colours for each pane's crosshair (axial/sag/cor → red/green/blue).
const LINE_COLORS: Record<string, string> = {
	[A.ax]: "rgb(200,0,0)", [A.sag]: "rgb(200,200,0)", [A.cor]: "rgb(0,200,0)",
	[B.ax]: "rgb(200,0,0)", [B.sag]: "rgb(200,200,0)", [B.cor]: "rgb(0,200,0)",
};

export type CompareElements = {
	aAx: HTMLDivElement; aSag: HTMLDivElement; aCor: HTMLDivElement;
	bAx: HTMLDivElement; bSag: HTMLDivElement; bCor: HTMLDivElement;
};
export type CompareSources = {
	ctA: string; segA: string; ctB: string; segB: string;
};
export type CompareHandle = {
	setLinked: (linked: boolean) => void;
	setSyncCursor: (sync: boolean) => void;
	setSegVisible: (visible: boolean) => void;
	setSegOpacity: (alpha: number) => void;
	applyWindow: (width: number, center: number) => void;
	resetView: () => void;
	destroy: () => void;
};

type SliceViewport = Types.IVolumeViewport & { getNumberOfSlices?: () => number };

let inited = false;
async function ensureInit() {
	if (inited) return;
	await coreInit();
	await tools.init();
	await niftiInit();
	imageLoader.registerImageLoader("nifti", cornerstoneNiftiImageLoader);
	inited = true;
}

// Dense LUT indexed by label id, from the same organ colours the single viewer uses.
function buildColorLUT(): ColorLUT {
	const colors = segmentation_category_colors as Record<number, Color>;
	const max = Math.max(0, ...Object.keys(colors).map(Number));
	const lut = Array.from({ length: max + 1 }, () => [0, 0, 0, 0] as Color) as ColorLUT;
	for (const k of Object.keys(colors)) lut[Number(k)] = colors[Number(k)];
	return lut;
}

const sliceCount = (vp: SliceViewport): number =>
	vp.getNumberOfSlices?.() ?? vp.getImageData()?.dimensions?.[2] ?? 1;

let currentEngine: RenderingEngine | null = null;

function makeToolGroup(id: string, viewportIds: string[]) {
	try {
		tools.ToolGroupManager.destroyToolGroup(id);
	} catch {
		/* none yet */
	}
	const tg = tools.ToolGroupManager.createToolGroup(id);
	if (!tg) throw new Error(`Failed to create tool group ${id}`);
	tools.addTool(tools.CrosshairsTool);
	tools.addTool(tools.StackScrollTool);
	tools.addTool(tools.PanTool);
	tools.addTool(tools.ZoomTool);
	tg.addTool(tools.CrosshairsTool.toolName, {
		getReferenceLineColor: (vpId: string) => LINE_COLORS[vpId] ?? "rgb(200,200,200)",
		getReferenceLineControllable: () => true,
		getReferenceLineDraggableRotatable: () => true,
		getReferenceLineSlabThicknessControlsOn: () => false,
	});
	tg.addTool(tools.StackScrollTool.toolName);
	tg.addTool(tools.PanTool.toolName);
	tg.addTool(tools.ZoomTool.toolName);
	viewportIds.forEach((v) => tg.addViewport(v, ENGINE_ID));
	const { MouseBindings } = tools.Enums;
	tg.setToolActive(tools.CrosshairsTool.toolName, { bindings: [{ mouseButton: MouseBindings.Primary }] });
	tg.setToolActive(tools.StackScrollTool.toolName, { bindings: [{ mouseButton: MouseBindings.Wheel }] });
	tg.setToolActive(tools.PanTool.toolName, { bindings: [{ mouseButton: MouseBindings.Auxiliary }] });
	tg.setToolActive(tools.ZoomTool.toolName, { bindings: [{ mouseButton: MouseBindings.Secondary }] });
	return tg;
}

// Load one case's CT + segmentation into its 3 viewports. Segmentation failures are
// swallowed so the CT still shows (dev checkouts often lack masks).
async function loadCase(
	engine: RenderingEngine,
	ctUrl: string,
	segUrl: string,
	viewportIds: string[],
	segmentationId: string,
	colorLUT: ColorLUT
) {
	const ctIds = await createNiftiImageIdsAndCacheMetadata({ url: ctUrl });
	const ctVolId = `${segmentationId}_ct:${ctUrl}`;
	const ctVol = await volumeLoader.createAndCacheVolume(ctVolId, { imageIds: ctIds });
	await ctVol.load();
	await setVolumesForViewports(engine, [{ volumeId: ctVolId }], viewportIds);
	engine.renderViewports(viewportIds);

	try {
		const segIds = await createNiftiImageIdsAndCacheMetadata({ url: segUrl });
		if (!segIds.length) return;
		const segVol = await volumeLoader.createAndCacheVolume(segmentationId, { imageIds: segIds });
		await segVol.load();
		tools.segmentation.segmentationStyle.setStyle(
			{ type: SegmentationRepresentations.Labelmap, segmentationId },
			SEG_CONFIG
		);
		tools.segmentation.addSegmentations([
			{
				segmentationId,
				representation: {
					type: SegmentationRepresentations.Labelmap,
					data: { imageIds: segIds, volumeId: segmentationId },
				},
			},
		]);
		for (const vpId of viewportIds) {
			await tools.segmentation.addSegmentationRepresentations(vpId, [
				{ segmentationId, type: SegmentationRepresentations.Labelmap, config: { colorLUTOrIndex: colorLUT } },
			]);
			tools.segmentation.activeSegmentation.setActiveSegmentation(vpId, segmentationId);
		}
	} catch (e) {
		console.warn(`[compare] segmentation unavailable for ${segmentationId}:`, e);
	}
}

export async function setupCompare(els: CompareElements, src: CompareSources): Promise<CompareHandle> {
	await ensureInit();

	try {
		tools.ToolGroupManager.destroyToolGroup(A.tg);
		tools.ToolGroupManager.destroyToolGroup(B.tg);
	} catch {
		/* none yet */
	}
	if (currentEngine) {
		currentEngine.destroy();
		currentEngine = null;
	}

	const engine = new RenderingEngine(ENGINE_ID);
	currentEngine = engine;

	const O = Enums.OrientationAxis;
	engine.setViewports([
		{ viewportId: A.ax, type: Enums.ViewportType.ORTHOGRAPHIC, element: els.aAx, defaultOptions: { orientation: O.AXIAL } },
		{ viewportId: A.sag, type: Enums.ViewportType.ORTHOGRAPHIC, element: els.aSag, defaultOptions: { orientation: O.SAGITTAL } },
		{ viewportId: A.cor, type: Enums.ViewportType.ORTHOGRAPHIC, element: els.aCor, defaultOptions: { orientation: O.CORONAL } },
		{ viewportId: B.ax, type: Enums.ViewportType.ORTHOGRAPHIC, element: els.bAx, defaultOptions: { orientation: O.AXIAL } },
		{ viewportId: B.sag, type: Enums.ViewportType.ORTHOGRAPHIC, element: els.bSag, defaultOptions: { orientation: O.SAGITTAL } },
		{ viewportId: B.cor, type: Enums.ViewportType.ORTHOGRAPHIC, element: els.bCor, defaultOptions: { orientation: O.CORONAL } },
	]);

	// One crosshair-linked tool group per case (each case's 3 planes navigate together).
	makeToolGroup(A.tg, [A.ax, A.sag, A.cor]);
	makeToolGroup(B.tg, [B.ax, B.sag, B.cor]);

	const colorLUT = buildColorLUT();
	tools.segmentation.removeAllSegmentations();
	await loadCase(engine, src.ctA, src.segA, [A.ax, A.sag, A.cor], A.seg, colorLUT);
	await loadCase(engine, src.ctB, src.segB, [B.ax, B.sag, B.cor], B.seg, colorLUT);

	// --- Proportional axial slice sync across the two cases ---
	let linked = true;
	let syncing = false;
	const mirror = (srcId: string, dstId: string) => () => {
		if (!linked || syncing) return;
		const s = engine.getViewport(srcId) as SliceViewport;
		const d = engine.getViewport(dstId) as SliceViewport;
		if (!s || !d) return;
		const nS = sliceCount(s), nD = sliceCount(d);
		if (nS <= 1 || nD <= 1) return;
		const target = Math.round((s.getSliceIndex() / (nS - 1)) * (nD - 1));
		const delta = target - d.getSliceIndex();
		if (delta === 0) return;
		syncing = true;
		d.scroll(delta);
		setTimeout(() => { syncing = false; }, 0);
	};
	const onA = mirror(A.ax, B.ax);
	const onB = mirror(B.ax, A.ax);
	els.aAx.addEventListener(Enums.Events.CAMERA_MODIFIED, onA);
	els.bAx.addEventListener(Enums.Events.CAMERA_MODIFIED, onB);

	// --- Cross-case cursor sync: mirror one case's crosshair onto the other at the same
	// proportional position within its volume (the two patients have different geometry, so
	// we map through voxel-index fractions). Off by default. ---
	const caseViewports: Record<string, string[]> = {
		[A.tg]: [A.ax, A.sag, A.cor],
		[B.tg]: [B.ax, B.sag, B.cor],
	};
	let syncCursor = false;
	let applyingCursor = false;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const onCrosshair = (evt: any) => {
		if (!syncCursor || applyingCursor) return;
		const srcTg = evt?.detail?.toolGroupId as string;
		const center = evt?.detail?.toolCenter as [number, number, number];
		const route =
			srcTg === A.tg
				? { srcVp: A.ax, dstVp: B.ax, dstTg: B.tg }
				: srcTg === B.tg
					? { srcVp: B.ax, dstVp: A.ax, dstTg: A.tg }
					: null;
		if (!route || !center) return;
		try {
			const src = engine.getViewport(route.srcVp)?.getImageData();
			const dst = engine.getViewport(route.dstVp)?.getImageData();
			if (!src || !dst) return;
			const sIdx = csUtils.transformWorldToIndexContinuous(src.imageData, center);
			const dIdx = [0, 1, 2].map((i) => {
				const frac = Math.min(1, Math.max(0, sIdx[i] / ((src.dimensions[i] - 1) || 1)));
				return frac * ((dst.dimensions[i] - 1) || 1);
			}) as [number, number, number];
			const world = csUtils.transformIndexToWorld(dst.imageData, dIdx);
			const dstTool = tools.ToolGroupManager.getToolGroup(route.dstTg)?.getToolInstance(
				tools.CrosshairsTool.toolName
			) as { setToolCenter?: (mm: number[], suppress?: boolean) => void } | undefined;
			if (dstTool?.setToolCenter) {
				applyingCursor = true;
				dstTool.setToolCenter(world, true); // suppressEvents → no feedback loop
				engine.renderViewports(caseViewports[route.dstTg]);
				applyingCursor = false;
			}
		} catch (e) {
			console.warn("[compare] cursor sync failed:", e);
			applyingCursor = false;
		}
	};
	eventTarget.addEventListener(tools.Enums.Events.CROSSHAIR_TOOL_CENTER_CHANGED, onCrosshair);

	const allVps = [A.ax, A.sag, A.cor, B.ax, B.sag, B.cor];

	return {
		setLinked(next) {
			linked = next;
		},
		setSyncCursor(next) {
			syncCursor = next;
		},
		setSegVisible(visible) {
			for (const vpId of allVps) {
				try {
					tools.segmentation.config.visibility.setSegmentationRepresentationVisibility(
						vpId,
						{ segmentationId: vpId.startsWith("cmp_a") ? A.seg : B.seg, type: SegmentationRepresentations.Labelmap },
						visible
					);
				} catch {
					/* representation may be absent */
				}
			}
			engine.renderViewports(allVps);
		},
		setSegOpacity(alpha) {
			for (const segId of [A.seg, B.seg]) {
				try {
					tools.segmentation.config.style.setStyle(
						{ type: SegmentationRepresentations.Labelmap, segmentationId: segId },
						{ ...SEG_CONFIG, fillAlpha: alpha, fillAlphaInactive: alpha }
					);
				} catch {
					/* segmentation may be absent */
				}
			}
			engine.renderViewports(allVps);
		},
		applyWindow(width, center) {
			const low = center - width / 2;
			const high = center + width / 2;
			for (const vpId of allVps) {
				const vp = engine.getViewport(vpId);
				const actor = vp?.getDefaultActor();
				if (!actor) continue;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const tf = (actor.actor.getProperty() as any).getRGBTransferFunction(0);
				tf.setMappingRange(low, high);
				tf.updateRange();
				vp.render();
			}
		},
		resetView() {
			for (const vpId of allVps) {
				const vp = engine.getViewport(vpId);
				vp?.resetCamera();
				vp?.render();
			}
		},
		destroy() {
			els.aAx.removeEventListener(Enums.Events.CAMERA_MODIFIED, onA);
			els.bAx.removeEventListener(Enums.Events.CAMERA_MODIFIED, onB);
			eventTarget.removeEventListener(tools.Enums.Events.CROSSHAIR_TOOL_CENTER_CHANGED, onCrosshair);
			try {
				tools.segmentation.removeAllSegmentations();
				tools.ToolGroupManager.destroyToolGroup(A.tg);
				tools.ToolGroupManager.destroyToolGroup(B.tg);
			} catch {
				/* ignore */
			}
			if (currentEngine) {
				currentEngine.destroy();
				currentEngine = null;
			}
		},
	};
}
