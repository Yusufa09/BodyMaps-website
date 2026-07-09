import { cache, init as coreInit, Enums, eventTarget, getRenderingEngine, imageLoader, RenderingEngine, setVolumesForViewports, volumeLoader } from "@cornerstonejs/core";
import type { ColorLUT } from "@cornerstonejs/core/types";
import { cornerstoneNiftiImageLoader, createNiftiImageIdsAndCacheMetadata, init as niftiImageLoaderInit } from "@cornerstonejs/nifti-volume-loader";
import * as cornerstoneTools from '@cornerstonejs/tools';
import { init as cornerstoneToolsInit } from '@cornerstonejs/tools';
import { SegmentationRepresentations } from "@cornerstonejs/tools/enums";

type viewportIdTypes = 'CT_NIFTI_AXIAL' | 'CT_NIFTI_SAGITTAL' | 'CT_NIFTI_CORONAL';

const {
    ToolGroupManager,
    Enums: csToolsEnums,
    segmentation,
    annotation,
    PanTool,
    ZoomTool,
    StackScrollTool,
    CrosshairsTool,
    LengthTool,
    ProbeTool,
    RectangleROITool,
    AngleTool,
    EllipticalROITool,
} = cornerstoneTools;

// Measurement tools the toolbar can switch the primary mouse button to. Length =
// distance in mm, Probe = HU readout at a point, RectangleROI/EllipticalROI =
// area + mean/max/min HU, Angle = angle in degrees between two segments.
export const LENGTH_TOOL = LengthTool.toolName;
export const PROBE_TOOL = ProbeTool.toolName;
export const ROI_TOOL = RectangleROITool.toolName;
export const ANGLE_TOOL = AngleTool.toolName;
export const ELLIPSE_TOOL = EllipticalROITool.toolName;
export const MEASUREMENT_TOOL_NAMES = [LENGTH_TOOL, ANGLE_TOOL, PROBE_TOOL, ROI_TOOL, ELLIPSE_TOOL] as const;
export type MeasurementToolName = (typeof MEASUREMENT_TOOL_NAMES)[number];

// Cornerstone's defaults draw measurements in yellow (resting) / green (selected) — the
// standard radiology-viewer convention for a plain grayscale background. BodyMaps overlays
// colored organ masks (reds/pinks/purples/teal), so yellow/green collide with them. Cyan
// gives the strongest contrast over the warm masks while still reading on grayscale CT;
// selected annotations go white for clear edit feedback. The dashed leader line that
// tethers each label to its measurement is recolored to match.
const MEASURE_COLOR = "#22d3ee"; // cyan — resting
const MEASURE_COLOR_HI = "#67e8f9"; // lighter cyan — hover
const MEASUREMENT_ANNOTATION_STYLE = {
    color: MEASURE_COLOR,
    colorHighlighted: MEASURE_COLOR_HI,
    colorSelected: "#ffffff",
    colorLocked: MEASURE_COLOR,
    lineWidth: "2",
    textBoxColor: MEASURE_COLOR,
    textBoxColorHighlighted: MEASURE_COLOR_HI,
    textBoxColorSelected: "#ffffff",
    textBoxLinkLineColor: MEASURE_COLOR,
    // Pin the font/shadow too: if a prior (partial) style ever persisted in module state,
    // the merge base could be missing these and the value labels wouldn't render.
    textBoxFontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif",
    textBoxFontSize: "14px",
    shadow: true,
};

const renderingEngineId = "rendering_engine";
const toolGroupId = "myToolGroup";
const DEFAULT_SEGMENTATION_CONFIG = {
    fillAlpha: 0.6,
    fillAlphaInactive: 0.6,
    outlineOpacity: 1,
    outlineWidth: 1,
    renderOutline: false,
    outlineOpacityInactive: 0
};


const volumeId = "myVolume";
const segmentationId = "mySegmentation";
// const volumeId = `${volumeLoaderScheme}:${mainNiftiURL}`;
// const segmentationId = `${volumeLoaderScheme}:${segmentationURL}`;

const viewportId1 = "CT_NIFTI_AXIAL";
const viewportId2 = "CT_NIFTI_SAGITTAL";
const viewportId3 = "CT_NIFTI_CORONAL";

let currentRenderingEngine: RenderingEngine | null = null;

let _crosshairChangeCallbacks = new Set<(mm: number[]) => void>();
let _isSyncing = false;
let _crosshairListenerRegistered = false;

function _handleCrosshairCenterChanged(evt: Event) {
    if (_isSyncing) return;

    const toolCenter = (evt as CustomEvent).detail?.toolCenter as number[] | undefined;

    if (!toolCenter || toolCenter.length < 3) return;

    for (const cb of _crosshairChangeCallbacks) {
        cb(toolCenter);
    }
}

export function registerCrosshairListener(eventTarget: EventTarget, cornerstoneTools: any) {
    if (!_crosshairListenerRegistered) {
        eventTarget.addEventListener(
            cornerstoneTools.Enums.Events.CROSSHAIR_TOOL_CENTER_CHANGED,
            _handleCrosshairCenterChanged
        );

        _crosshairListenerRegistered = true;
    }
}

export function subscribeToCrosshairChanges(cb: (mm: number[]) => void) {
    _crosshairChangeCallbacks.add(cb);

    return () => {
        _crosshairChangeCallbacks.delete(cb);
    };
}

export function setCrosshairSyncing(value: boolean) {
    _isSyncing = value;
}

export function moveCornerstoneCrosshairToMm(mm: [number, number, number]) {
    const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
    if (!toolGroup) return;
    const tool = toolGroup.getToolInstance(CrosshairsTool.toolName) as {
        setToolCenter?: (mm: number[], suppressEvents?: boolean) => void;
    };
    if (!tool?.setToolCenter) return;
    _isSyncing = true;
    try {
        tool.setToolCenter(mm, true); // suppressEvents=true prevents re-triggering
    } finally {
        _isSyncing = false;
    }
}

// Current crosshair world position (mm), or null if the tool isn't ready. Used to capture
// the focal point for a shareable link without waiting on a crosshair-change event.
export function getCrosshairMm(): [number, number, number] | null {
    const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
    const tool = toolGroup?.getToolInstance(CrosshairsTool.toolName) as
        | { toolCenter?: number[] }
        | undefined;
    const c = tool?.toolCenter;
    if (!c || c.length < 3 || !c.every((n: number) => Number.isFinite(n))) return null;
    return [c[0], c[1], c[2]];
}
const viewportColors: Record<viewportIdTypes, string> = {
    [viewportId1]: 'rgb(200, 0, 0)',
    [viewportId2]: 'rgb(200, 200, 0)',
    [viewportId3]: 'rgb(0, 200, 0)',
};
function getReferenceLineColor(viewportId: viewportIdTypes) {
    return viewportColors[viewportId];
}


function getReferenceLineControllable(viewportId: viewportIdTypes) {
    const index = [viewportId1, viewportId2, viewportId3].indexOf(viewportId);
    return index !== -1;
}

function getReferenceLineDraggableRotatable(viewportId: viewportIdTypes) {
    const index = [viewportId1, viewportId2, viewportId3].indexOf(viewportId);
    return index !== -1;
}

function getReferenceLineSlabThicknessControlsOn(viewportId: viewportIdTypes) {
    const index =
        [viewportId1, viewportId2, viewportId3].indexOf(viewportId);
    return index !== -1;
}
// Subscribe to the nifti loader's real download progress (bytes loaded / total) so
// the UI can show an accurate, measured ETA. Returns an unsubscribe fn.
export function subscribeToVolumeProgress(
	cb: (loaded: number, total: number, volumeId: string) => void
): () => void {
	const handler = (evt: Event) => {
		const detail = (evt as CustomEvent).detail;
		const data = detail?.data ?? detail;
		if (data && typeof data.loaded === "number" && typeof data.total === "number") {
			cb(data.loaded, data.total, String(data.volumeId ?? ""));
		}
	};
	// Event name from @cornerstonejs/nifti-volume-loader (Events.NIFTI_VOLUME_PROGRESS).
	eventTarget.addEventListener("CORNERSTONE_NIFTI_VOLUME_PROGRESS", handler as EventListener);
	return () =>
		eventTarget.removeEventListener("CORNERSTONE_NIFTI_VOLUME_PROGRESS", handler as EventListener);
}

// Cornerstone core/loader/tools only need initializing once per page load;
// re-running them on every case load (HD toggle, navigation) risks duplicate
// tool registration. Mirrors the guard in compareViewer.ts.
let _cornerstoneInited = false;

export async function renderVisualization(ref1: HTMLDivElement, ref2: HTMLDivElement, ref3: HTMLDivElement, convertedColorLUT: ColorLUT, ctUrl: string, segUrl: string | undefined, setLoading: React.Dispatch<React.SetStateAction<boolean>>) {
    if (!_cornerstoneInited) {
        coreInit();
        niftiImageLoaderInit();
        cornerstoneToolsInit();
        _cornerstoneInited = true;
    }
    _organCentroids = null; // recomputed lazily for the new case's segmentation

    const mainNiftiURL = ctUrl;
    const segmentationURL = segUrl;
    ToolGroupManager.destroyToolGroup(toolGroupId);
    const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);
    if (!toolGroup) {
        throw new Error("Failed to create tool group");
    }

    
    cornerstoneTools.addTool(PanTool);
    cornerstoneTools.addTool(ZoomTool);
    cornerstoneTools.addTool(StackScrollTool);
    cornerstoneTools.addTool(CrosshairsTool);
    cornerstoneTools.addTool(LengthTool);
    cornerstoneTools.addTool(ProbeTool);
    cornerstoneTools.addTool(RectangleROITool);
    cornerstoneTools.addTool(AngleTool);
    cornerstoneTools.addTool(EllipticalROITool);
    toolGroup.addTool(PanTool.toolName);
    toolGroup.addTool(ZoomTool.toolName);
    toolGroup.addTool(StackScrollTool.toolName);
    toolGroup.addTool(LengthTool.toolName);
    toolGroup.addTool(ProbeTool.toolName);
    toolGroup.addTool(RectangleROITool.toolName);
    toolGroup.addTool(AngleTool.toolName);
    toolGroup.addTool(EllipticalROITool.toolName);
    // Merge our color overrides onto the existing defaults — replacing wholesale would
    // drop font/background/shadow defaults and the value labels would stop rendering.
    const defaultStyles = annotation.config.style.getDefaultToolStyles();
    annotation.config.style.setDefaultToolStyles({
        ...defaultStyles,
        global: { ...(defaultStyles.global ?? {}), ...MEASUREMENT_ANNOTATION_STYLE },
    });
    toolGroup.addTool(CrosshairsTool.toolName, {
        getReferenceLineColor,
        getReferenceLineControllable,
        getReferenceLineDraggableRotatable,
        getReferenceLineSlabThicknessControlsOn,
        // viewportIndicators: true,
        mobile: {
            enabled: false,
            opacity: 0.8,
            handleRadius: 16,
        },
        handleRadius:8
    })
    if (!_crosshairListenerRegistered) {
        eventTarget.addEventListener(cornerstoneTools.Enums.Events.CROSSHAIR_TOOL_CENTER_CHANGED, _handleCrosshairCenterChanged);
        _crosshairListenerRegistered = true;
    }

    if (currentRenderingEngine) {
        currentRenderingEngine.destroy();
        currentRenderingEngine = null;
    }
    
    const renderingEngine = new RenderingEngine(renderingEngineId);
    currentRenderingEngine = renderingEngine;
    
    imageLoader.registerImageLoader("nifti", cornerstoneNiftiImageLoader);
    const imageIds = await createNiftiImageIdsAndCacheMetadata({ url: mainNiftiURL });
    const segmentationImageIds = segmentationURL
    ? await createNiftiImageIdsAndCacheMetadata({ url: segmentationURL })
    : [];
    
    const viewportInputArray = [
        {
            viewportId: viewportId1,
            type: Enums.ViewportType.ORTHOGRAPHIC,
            element: ref1,
            defaultOptions: {
                orientation: Enums.OrientationAxis.AXIAL
            }
        },
        {
            viewportId: viewportId2,
            type: Enums.ViewportType.ORTHOGRAPHIC,
            element: ref2,
            defaultOptions: {
                orientation: Enums.OrientationAxis.SAGITTAL
            }
        },
        {
            viewportId: viewportId3,
            type: Enums.ViewportType.ORTHOGRAPHIC,
            element: ref3,
            defaultOptions: {
                orientation: Enums.OrientationAxis.CORONAL
            }
        }
    ];

    // viewportInputArray.forEach((viewport) => toolGroup)
    viewportInputArray.forEach((viewport) => toolGroup.addViewport(viewport.viewportId, renderingEngineId));
    toolGroup.setToolActive(CrosshairsTool.toolName, {
        bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }]
    })
    toolGroup.setToolActive(StackScrollTool.toolName, {
        bindings: [{ mouseButton: csToolsEnums.MouseBindings.Wheel }]
    })
    // Measurement tools start passive: their annotations stay selectable/editable, but
    // the primary button keeps driving the crosshair until the user picks a measure tool.
    for (const toolName of MEASUREMENT_TOOL_NAMES) {
        toolGroup.setToolPassive(toolName);
    }

    renderingEngine.setViewports(viewportInputArray);

    const volume = await volumeLoader.createAndCacheVolume(volumeId, { imageIds });
    await volume.load();
    await setVolumesForViewports(
        renderingEngine,
        [{ volumeId }],
        viewportInputArray.map((viewport) => viewport.viewportId)
    );

    renderingEngine.renderViewports(viewportInputArray.map((viewport) => viewport.viewportId));

    if (segmentationURL && segmentationImageIds.length > 0 && segmentation) {
        const segmentationVolume = await volumeLoader.createAndCacheVolume(segmentationId, {
            imageIds: segmentationImageIds
        });

        await segmentationVolume.load();

        segmentation.segmentationStyle.setStyle({ type: SegmentationRepresentations.Labelmap, segmentationId: segmentationId }, DEFAULT_SEGMENTATION_CONFIG);
        segmentation.removeAllSegmentations();
        segmentation.addSegmentations([
            {
                segmentationId,
                representation: {
                    type: SegmentationRepresentations.Labelmap,
                    data: {
                        imageIds: segmentationImageIds,
                        volumeId: segmentationId
                    },
                },
            },
        ]);

        viewportInputArray.forEach(async (viewport) => {
            await segmentation.addSegmentationRepresentations(viewport.viewportId, [
                {
                    segmentationId,
                    type: csToolsEnums.SegmentationRepresentations.Labelmap,
                    config: {
                        colorLUTOrIndex: convertedColorLUT
                    }
                }
            ]);
            segmentation.activeSegmentation.setActiveSegmentation(viewport.viewportId, segmentationId);
        });
    }

    renderingEngine.renderViewports(viewportInputArray.map((viewport) => viewport.viewportId));
    setLoading(false);
    return {
        viewportIds: viewportInputArray.map((viewport) => viewport.viewportId),
        renderingEngine: renderingEngine,
        volumeId: volumeId
    }
}


export function setVisibilities(checkState: boolean[]) {
    for (let i = 1; i < checkState.length; i++) {
        if (!segmentation.getActiveSegmentation(viewportId1)) return;
        segmentation.segmentIndex.setActiveSegmentIndex(segmentationId, i);
        segmentation.config.visibility.setSegmentIndexVisibility(viewportId1, { segmentationId: segmentationId, type: csToolsEnums.SegmentationRepresentations.Labelmap }, i, checkState[i]);
        segmentation.config.visibility.setSegmentIndexVisibility(viewportId2, { segmentationId: segmentationId, type: csToolsEnums.SegmentationRepresentations.Labelmap }, i, checkState[i]);
        segmentation.config.visibility.setSegmentIndexVisibility(viewportId3, { segmentationId: segmentationId, type: csToolsEnums.SegmentationRepresentations.Labelmap }, i, checkState[i]);
    }
    if (currentRenderingEngine) {
        currentRenderingEngine.renderViewports([viewportId1, viewportId2, viewportId3]);
        currentRenderingEngine.render();
    }

};


export function setToolGroupOpacity(opacityValue: number) {
    const newSegConfig = { ...DEFAULT_SEGMENTATION_CONFIG };
    newSegConfig.fillAlpha = opacityValue;
    newSegConfig.fillAlphaInactive = opacityValue;
    newSegConfig.outlineOpacity = opacityValue;
    newSegConfig.outlineOpacityInactive = opacityValue;
    segmentation.config.style.setStyle({
        type: csToolsEnums.SegmentationRepresentations.Labelmap,
        segmentationId: segmentationId,
    }, {
        ...DEFAULT_SEGMENTATION_CONFIG,
        fillAlpha: opacityValue / 2.4,
        fillAlphaInactive: opacityValue / 2.4,
        outlineOpacity: opacityValue / 2.4,
        outlineOpacityInactive: opacityValue / 2.4,

    });
    if (currentRenderingEngine) {
        currentRenderingEngine.renderViewports([viewportId1, viewportId2, viewportId3]);
        currentRenderingEngine.render();
    }
}

export function toggleCrosshairTool(enable: boolean) {
  const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
  if (!toolGroup) return;
  if (enable) {
    toolGroup.setToolActive(CrosshairsTool.toolName, {
      bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }],
    });
    toolGroup.setToolDisabled(PanTool.toolName);
  } else {
    toolGroup.setToolDisabled(CrosshairsTool.toolName);
    toolGroup.setToolActive(PanTool.toolName, {
      bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }],
    });
  }
}

// Activate a measurement tool on the primary mouse button, or pass `null` to hand the
// primary button back to navigation (the caller restores crosshair/pan afterwards).
// While a measure tool is active we disable crosshair + pan so clicks draw, not navigate.
export function setActiveMeasurementTool(toolName: MeasurementToolName | null) {
  const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
  if (!toolGroup) return;
  // Reset every measure tool to passive first (keeps existing annotations editable).
  for (const name of MEASUREMENT_TOOL_NAMES) toolGroup.setToolPassive(name);
  if (!toolName) return;
  toolGroup.setToolDisabled(CrosshairsTool.toolName);
  toolGroup.setToolDisabled(PanTool.toolName);
  toolGroup.setToolActive(toolName, {
    bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }],
  });
}

// Remove only measurement annotations (Length/Probe/ROI), leaving the crosshair intact.
export function clearMeasurements() {
  try {
    const all = annotation.state.getAllAnnotations() ?? [];
    const names = MEASUREMENT_TOOL_NAMES as readonly string[];
    for (const a of [...all]) {
      const toolName = a?.metadata?.toolName;
      if (toolName && names.includes(toolName) && a.annotationUID) {
        annotation.state.removeAnnotation(a.annotationUID);
      }
    }
  } catch {
    /* annotation state may not be ready (e.g. before first render) — no-op */
  }
  currentRenderingEngine?.render();
}

// ---------------------------------------------------------------------------
// Measurement inventory — a UI-friendly view over Cornerstone's annotation
// state, powering the Measurements panel and the reading-session report.
// ---------------------------------------------------------------------------

export type MeasurementSummary = {
  uid: string;
  tool: string;
  /** User-assigned name (e.g. "lesion"); empty until renamed. */
  label: string;
  /** Formatted value, e.g. "42.3 mm", "37.5°", "512 mm² · mean 45 HU". */
  value: string;
  /** World-mm center of the annotation's handles (jump target), if known. */
  center: [number, number, number] | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any -- annotation payloads are untyped */
function formatNum(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "?";
}

// Each tool caches different stats keys; scan for the ones we know how to show.
function formatAnnotationValue(a: any): string {
  const statsByTarget = a?.data?.cachedStats ?? {};
  for (const stats of Object.values(statsByTarget) as any[]) {
    if (!stats || typeof stats !== "object") continue;
    if (typeof stats.length === "number") return `${formatNum(stats.length)} ${stats.unit ?? "mm"}`;
    if (typeof stats.angle === "number") return `${formatNum(stats.angle)}°`;
    if (typeof stats.area === "number") {
      const area = `${formatNum(stats.area, 0)} ${stats.areaUnit ?? "mm²"}`;
      return typeof stats.mean === "number" ? `${area} · mean ${formatNum(stats.mean, 0)} HU` : area;
    }
    if (typeof stats.value === "number") return `${formatNum(stats.value, 0)} HU`;
    if (typeof stats.mean === "number") return `mean ${formatNum(stats.mean, 0)} HU`;
  }
  return "…";
}

function annotationCenter(a: any): [number, number, number] | null {
  const pts = a?.data?.handles?.points as number[][] | undefined;
  if (!pts?.length) return null;
  const c: [number, number, number] = [0, 0, 0];
  for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  return [c[0] / pts.length, c[1] / pts.length, c[2] / pts.length];
}

function toSummary(a: any): MeasurementSummary {
  return {
    uid: String(a.annotationUID),
    tool: String(a?.metadata?.toolName ?? ""),
    label: String(a?.data?.label ?? ""),
    value: formatAnnotationValue(a),
    center: annotationCenter(a),
  };
}

export function getMeasurementSummaries(): MeasurementSummary[] {
  try {
    const all = annotation.state.getAllAnnotations() ?? [];
    const names = MEASUREMENT_TOOL_NAMES as readonly string[];
    return (all as any[])
      .filter((a) => a?.annotationUID && names.includes(a?.metadata?.toolName))
      .map(toSummary);
  } catch {
    return [];
  }
}

export function renameMeasurement(uid: string, label: string) {
  const a = annotation.state.getAnnotation(uid) as any;
  if (!a?.data) return;
  a.data.label = label;
  currentRenderingEngine?.render();
}

export function removeMeasurement(uid: string) {
  try { annotation.state.removeAnnotation(uid); } catch { /* already gone */ }
  currentRenderingEngine?.render();
}

// Moves the crosshair to the annotation and returns the target (so the caller
// can also sync its own crosshair state / the 3D view).
export function jumpToMeasurement(uid: string): [number, number, number] | null {
  const a = annotation.state.getAnnotation(uid) as any;
  const c = annotationCenter(a);
  if (!c) return null;
  moveCornerstoneCrosshairToMm(c);
  currentRenderingEngine?.render();
  return c;
}

export type MeasurementChangeKind = "completed" | "modified" | "removed";

// Fires for measurement annotations only (crosshair events are filtered out).
export function subscribeToMeasurementChanges(
  cb: (kind: MeasurementChangeKind, summary: MeasurementSummary) => void
): () => void {
  const names = MEASUREMENT_TOOL_NAMES as readonly string[];
  const make = (kind: MeasurementChangeKind) => (evt: Event) => {
    const a = (evt as CustomEvent).detail?.annotation;
    if (!a?.annotationUID || !names.includes(a?.metadata?.toolName)) return;
    cb(kind, toSummary(a));
  };
  const pairs: [string, EventListener][] = [
    [cornerstoneTools.Enums.Events.ANNOTATION_COMPLETED, make("completed") as EventListener],
    [cornerstoneTools.Enums.Events.ANNOTATION_MODIFIED, make("modified") as EventListener],
    [cornerstoneTools.Enums.Events.ANNOTATION_REMOVED, make("removed") as EventListener],
  ];
  for (const [name, handler] of pairs) eventTarget.addEventListener(name, handler);
  return () => {
    for (const [name, handler] of pairs) eventTarget.removeEventListener(name, handler);
  };
}

// ---------------------------------------------------------------------------
// Viewport screenshots — used by the reading session (auto key images) and the
// toolbar snapshot button. Annotations/reference lines live on an SVG overlay,
// not the WebGL-backed canvas, so each shot composites canvas + rasterized SVG.
// ---------------------------------------------------------------------------

export type ViewportImage = { name: string; dataUrl: string };

export async function captureViewportImages(): Promise<ViewportImage[]> {
  const engine = getRenderingEngine(renderingEngineId);
  if (!engine) return [];
  const names: Record<string, string> = {
    [viewportId1]: "axial",
    [viewportId2]: "sagittal",
    [viewportId3]: "coronal",
  };
  const out: ViewportImage[] = [];
  for (const viewportId of [viewportId1, viewportId2, viewportId3]) {
    try {
      const viewport = engine.getViewport(viewportId) as any;
      const canvas: HTMLCanvasElement | undefined = viewport?.canvas;
      const element: HTMLElement | undefined = viewport?.element;
      // offsetParent is null for display:none panes (single-view modes) — skip them.
      if (!canvas || !canvas.width || !element || element.offsetParent === null) continue;
      const composite = document.createElement("canvas");
      composite.width = canvas.width;
      composite.height = canvas.height;
      const ctx = composite.getContext("2d");
      if (!ctx) continue;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, composite.width, composite.height);
      ctx.drawImage(canvas, 0, 0);
      const svg = element.querySelector("svg");
      if (svg) {
        const clone = svg.cloneNode(true) as SVGElement;
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        // The overlay is sized in CSS pixels; give the clone explicit dimensions so
        // the rasterizer knows them, then scale to the canvas's device pixels.
        clone.setAttribute("width", String(canvas.clientWidth || canvas.width));
        clone.setAttribute("height", String(canvas.clientHeight || canvas.height));
        const img = new Image();
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve(); // shot is still useful without the overlay
          img.src =
            "data:image/svg+xml;charset=utf-8," +
            encodeURIComponent(new XMLSerializer().serializeToString(clone));
        });
        if (img.width) ctx.drawImage(img, 0, 0, composite.width, composite.height);
      }
      out.push({ name: names[viewportId], dataUrl: composite.toDataURL("image/png") });
    } catch {
      /* viewport not ready — skip this pane */
    }
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function setZoom(zoomValue: number){
  const engine = getRenderingEngine(renderingEngineId);
  [viewportId1, viewportId2, viewportId3].forEach((viewportId) => {
      if (engine){
        const viewport = engine.getViewport(viewportId);
        viewport.setZoom(zoomValue);
        viewport.render();
      }
    })
}

export function zoomToFit() {
  const engine = getRenderingEngine(renderingEngineId);
  [viewportId1, viewportId2, viewportId3].forEach((viewportId) => {
      if (engine){
        const viewport = engine.getViewport(viewportId);
        viewport.resetCamera({
            resetPan: true,
            resetZoom: true
        });
        viewport.render();
      }
    })
}

export function centerOnCursor(){
  const engine = getRenderingEngine(renderingEngineId);
  if (!engine) return;
  const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
  if (!toolGroup) return;
  const toolCenter = toolGroup.getToolInstance(CrosshairsTool.toolName).toolCenter;
  [viewportId1, viewportId2, viewportId3].forEach((viewportId) => {
    const viewport = engine.getViewport(viewportId);
    viewport.setViewReference({
    FrameOfReferenceUID: "1.2.840.10008.1.4",
    cameraFocalPoint: toolCenter
    })
    // if (viewportId == "CT_NIFTI_CORONAL"){
    //   viewport.setPan([-toolCenter[1], toolCenter[2]]);
    // }
    // if (viewportId == "CT_NIFTI_SAGITTAL"){
    //   viewport.setPan([toolCenter[2], toolCenter[0]]);
    // }
    viewport.render();
    })
}

export function getOrganLabelOnClick() {
    const engine = getRenderingEngine(renderingEngineId);
    if (!engine) return;
    const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
    if (!toolGroup) return;
    const toolActive = toolGroup.getToolInstance(CrosshairsTool.toolName).mode;
    if (toolActive !== csToolsEnums.ToolModes.Active) return;
    const volume = cache.getVolume(segmentationId);
    if (!volume || !volume.voxelManager) return;
    const indices = [viewportId2, viewportId3, viewportId1].map((viewportId) => {
      const viewport = engine.getViewport(viewportId);
      const idx = viewport.getSliceIndex();
    //   if (viewportId === viewportId1) {
    //       return volume.voxelManager.dimensions[2] - idx;
    //   }
      return idx;
    })

    // volume.voxelManager.forEach(({value, index, pointIJK}) => {
    //     if (value === 14) {
    //         console.log(pointIJK);
    //     }
    // })
    const idx = volume.voxelManager.getAtIJK(indices[0], indices[1], indices[2]);
    return idx;
}

// Centroid (world mm) of every segment label, from one pass over the labelmap. Cached for
// the loaded case (reset in renderVisualization). Lets the UI jump the crosshair to an
// organ. Returns null until the segmentation volume is available.
let _organCentroids: Record<number, [number, number, number]> | null = null;

export function getOrganCentroids(): Record<number, [number, number, number]> | null {
    if (_organCentroids) return _organCentroids;
    const volume = cache.getVolume(segmentationId);
    const vm = volume?.voxelManager;
    if (!volume || !vm) return null;

    const [dimX, dimY] = vm.dimensions;
    const sliceSize = dimX * dimY;
    // Sum voxel indices (and count) per label, so we can take the mean = centroid.
    const sums = new Map<number, { x: number; y: number; z: number; n: number }>();
    const add = (label: number, i: number, j: number, k: number) => {
        if (!label) return; // skip background (0)
        let s = sums.get(label);
        if (!s) { s = { x: 0, y: 0, z: 0, n: 0 }; sums.set(label, s); }
        s.x += i; s.y += j; s.z += k; s.n++;
    };

    // The segmentation is image-backed, so getScalarData() may not hold one contiguous
    // array. Prefer getCompleteScalarDataArray() (assembles the full volume), and fall back
    // to forEach (which hands us IJK per voxel) if it isn't available.
    let data: ArrayLike<number> | undefined;
    try { data = vm.getCompleteScalarDataArray?.(); } catch { /* fall through */ }
    if (data && data.length) {
        for (let idx = 0; idx < data.length; idx++) {
            const label = data[idx];
            if (!label) continue;
            const k = (idx / sliceSize) | 0;
            const rem = idx - k * sliceSize;
            const j = (rem / dimX) | 0;
            add(label, rem - j * dimX, j, k);
        }
    } else {
        vm.forEach((voxel) =>
            add(Number(voxel.value), voxel.pointIJK[0], voxel.pointIJK[1], voxel.pointIJK[2])
        );
    }

    const out: Record<number, [number, number, number]> = {};
    for (const [label, s] of sums) {
        // Mean voxel index → world mm via the volume's geometry (handles spacing/affine).
        // indexToWorld returns the point (it doesn't reliably fill an out-param).
        const w = volume.imageData?.indexToWorld([s.x / s.n, s.y / s.n, s.z / s.n]);
        if (w) out[label] = [w[0], w[1], w[2]];
    }
    _organCentroids = out;
    return out;
}