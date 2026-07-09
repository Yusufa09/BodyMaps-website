import { cache, init as coreInit, Enums, eventTarget, getRenderingEngine, imageLoader, metaData, RenderingEngine, setVolumesForViewports, utilities as csCoreUtils, volumeLoader } from "@cornerstonejs/core";
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
    BidirectionalTool,
    ArrowAnnotateTool,
    AdvancedMagnifyTool,
    BrushTool,
    TrackballRotateTool,
} = cornerstoneTools;

// Measurement tools the toolbar can switch the primary mouse button to. Length =
// distance in mm, Bidirectional = long + short axis (RECIST), Probe = HU readout
// at a point, RectangleROI/EllipticalROI = area + mean/max/min HU, Angle = angle
// in degrees between two segments, Arrow = labeled pointer at a finding.
export const LENGTH_TOOL = LengthTool.toolName;
export const BIDIRECTIONAL_TOOL = BidirectionalTool.toolName;
export const PROBE_TOOL = ProbeTool.toolName;
export const ROI_TOOL = RectangleROITool.toolName;
export const ANGLE_TOOL = AngleTool.toolName;
export const ELLIPSE_TOOL = EllipticalROITool.toolName;
export const ARROW_TOOL = ArrowAnnotateTool.toolName;
export const MEASUREMENT_TOOL_NAMES = [LENGTH_TOOL, BIDIRECTIONAL_TOOL, ANGLE_TOOL, PROBE_TOOL, ROI_TOOL, ELLIPSE_TOOL, ARROW_TOOL] as const;
export type MeasurementToolName = (typeof MEASUREMENT_TOOL_NAMES)[number];

// Magnify is a viewing aid, not a measurement: it shares the activation path (one
// owner of the primary button) but its loupe annotations are excluded from the
// measurement inventory/report, and are removed when the tool is put down.
// AdvancedMagnifyTool is required — plain MagnifyTool throws on volume viewports.
// (Annotated: its d.ts declares `static toolName: any`, which would poison the union.)
export const MAGNIFY_TOOL: string = AdvancedMagnifyTool.toolName;
export type PrimaryMouseToolName = MeasurementToolName | typeof MAGNIFY_TOOL;

// Mask-editing tools: two instances of BrushTool, one painting the active segment,
// one erasing (strategy ERASE writes segment 0). Registered passive; the toolbar's
// Edit panel activates one of them on the primary button.
export const EDIT_BRUSH = "MaskBrush";
export const EDIT_ERASER = "MaskEraser";
export const EDIT_TOOL_NAMES = [EDIT_BRUSH, EDIT_ERASER] as const;
export type MaskEditToolName = (typeof EDIT_TOOL_NAMES)[number];

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
const MPR_VIEWPORT_IDS = [viewportId1, viewportId2, viewportId3];

// Shaded volume rendering (3D pane "Volume" mode) — its OWN rendering engine,
// viewport and tool group. A separate engine is essential: sharing the MPR
// engine means enabling/disabling this viewport (or its resize) repacks the
// shared offscreen canvas and corrupts the axial/sagittal/coronal viewports.
const volume3DViewportId = "CT_VOLUME_3D";
const volume3DEngineId = "volume3d_engine";
const volume3DToolGroupId = "volume3DToolGroup";

function _getVolume3DEngine(): RenderingEngine {
  return (getRenderingEngine(volume3DEngineId) as RenderingEngine | undefined) ?? new RenderingEngine(volume3DEngineId);
}

let currentRenderingEngine: RenderingEngine | null = null;
// The CT volume currently on the MPR viewports (changes when the progressive
// full-res upgrade swaps it) and the color LUT used for the labelmap, kept so
// the segmentation representation can be rebuilt after a volume swap.
let _currentCtVolumeId: string | null = null;
let _lastColorLUT: ColorLUT | null = null;

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

export async function renderVisualization(ref1: HTMLDivElement, ref2: HTMLDivElement, ref3: HTMLDivElement, convertedColorLUT: ColorLUT, ctUrl: string, segUrl: string | undefined, setLoading: React.Dispatch<React.SetStateAction<boolean>>, opts?: { ctImageIds?: string[] }) {
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
    disableVolume3D(); // tear down any prior case's 3D engine/tool group
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
    cornerstoneTools.addTool(BidirectionalTool);
    cornerstoneTools.addTool(ArrowAnnotateTool);
    cornerstoneTools.addTool(AdvancedMagnifyTool);
    cornerstoneTools.addTool(BrushTool);
    toolGroup.addTool(PanTool.toolName);
    toolGroup.addTool(ZoomTool.toolName);
    toolGroup.addTool(StackScrollTool.toolName);
    toolGroup.addTool(LengthTool.toolName);
    toolGroup.addTool(ProbeTool.toolName);
    toolGroup.addTool(RectangleROITool.toolName);
    toolGroup.addTool(AngleTool.toolName);
    toolGroup.addTool(EllipticalROITool.toolName);
    toolGroup.addTool(BidirectionalTool.toolName);
    toolGroup.addTool(ArrowAnnotateTool.toolName);
    toolGroup.addTool(AdvancedMagnifyTool.toolName);
    // Mask editing: paint fills the active segment, the eraser writes segment 0.
    toolGroup.addToolInstance(EDIT_BRUSH, BrushTool.toolName, {
        activeStrategy: "FILL_INSIDE_CIRCLE",
    });
    toolGroup.addToolInstance(EDIT_ERASER, BrushTool.toolName, {
        activeStrategy: "ERASE_INSIDE_CIRCLE",
    });
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
    // The CT stack either streams from a NIfTI URL (dataset cases / sessions) or is a
    // set of already-registered DICOM imageIds (local "open DICOM folder" flow).
    const imageIds = opts?.ctImageIds ?? (await createNiftiImageIdsAndCacheMetadata({ url: mainNiftiURL }));
    const segmentationImageIds = segmentationURL
    ? await createNiftiImageIdsAndCacheMetadata({ url: segmentationURL })
    : [];
    // Dataset navigations are full page reloads, so the fixed volumeId never collides.
    // Local DICOM opens happen within one SPA session (upload → view → back → open
    // another folder), so each load needs a fresh id or the cache serves the old scan.
    const ctVolumeId = opts?.ctImageIds ? `dicomVolume-${Date.now()}` : volumeId;
    _currentCtVolumeId = ctVolumeId;
    _lastColorLUT = convertedColorLUT;
    
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
    toolGroup.setToolPassive(MAGNIFY_TOOL);
    // Brush/eraser start disabled — they only own the mouse while Edit mode is on.
    for (const toolName of EDIT_TOOL_NAMES) {
        toolGroup.setToolDisabled(toolName);
    }

    renderingEngine.setViewports(viewportInputArray);

    const volume = await volumeLoader.createAndCacheVolume(ctVolumeId, { imageIds });
    await volume.load();
    await setVolumesForViewports(
        renderingEngine,
        [{ volumeId: ctVolumeId }],
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

    // Local DICOM can be any modality (MR, PET, …), so the CT window presets are
    // meaningless — seed the viewer with the scan's *own* VOI from the DICOM header
    // (WindowCenter/WindowWidth). Without this the default CT soft-tissue window
    // clips non-CT data flat (uniform grey). NIfTI dataset scans are CT, so they
    // keep the preset-driven default (no VOI here).
    let initialVoi: { windowCenter: number; windowWidth: number } | undefined;
    if (opts?.ctImageIds && imageIds.length) {
        const voi = metaData.get("voiLutModule", imageIds[0]) as
            | { windowCenter?: number | number[]; windowWidth?: number | number[] }
            | undefined;
        const firstNum = (v: number | number[] | undefined) =>
            Array.isArray(v) ? v[0] : v;
        const wc = firstNum(voi?.windowCenter);
        const ww = firstNum(voi?.windowWidth);
        if (typeof wc === "number" && typeof ww === "number" && ww > 0) {
            initialVoi = { windowCenter: wc, windowWidth: ww };
        }
    }

    return {
        viewportIds: viewportInputArray.map((viewport) => viewport.viewportId),
        renderingEngine: renderingEngine,
        volumeId: ctVolumeId,
        initialVoi,
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
    // The loop above walks setActiveSegmentIndex through every id — restore the one the
    // brush is targeting, or edits would silently land on the last organ in the list.
    // Guarded: this effect also fires on mount, before the segmentation exists, and
    // setActiveSegmentIndex throws on a missing segmentation (blanks the whole page).
    try {
        if (segmentation.getActiveSegmentation(viewportId1)) {
            segmentation.segmentIndex.setActiveSegmentIndex(segmentationId, _activeEditSegment);
        }
    } catch {
        /* segmentation not loaded yet */
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

// The magnify loupes only make sense while the tool is in hand — remove them when
// it's put down (AdvancedMagnify cleans up its magnify viewport on ANNOTATION_REMOVED).
function _removeMagnifyAnnotations() {
  try {
    const all = annotation.state.getAllAnnotations() ?? [];
    for (const a of [...all]) {
      if (a?.metadata?.toolName === MAGNIFY_TOOL && a.annotationUID) {
        annotation.state.removeAnnotation(a.annotationUID);
      }
    }
  } catch {
    /* annotation state not ready */
  }
}

// Activate a measurement tool (or the magnify loupe) on the primary mouse button, or
// pass `null` to hand the primary button back to navigation (the caller restores
// crosshair/pan afterwards). While one is active we disable crosshair + pan so clicks
// draw, not navigate.
export function setActiveMeasurementTool(toolName: PrimaryMouseToolName | null) {
  const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
  if (!toolGroup) return;
  // Reset every measure tool to passive first (keeps existing annotations editable).
  for (const name of [...MEASUREMENT_TOOL_NAMES, MAGNIFY_TOOL]) toolGroup.setToolPassive(name);
  if (toolName !== MAGNIFY_TOOL) _removeMagnifyAnnotations();
  if (!toolName) return;
  toolGroup.setToolDisabled(CrosshairsTool.toolName);
  toolGroup.setToolDisabled(PanTool.toolName);
  for (const name of EDIT_TOOL_NAMES) toolGroup.setToolDisabled(name);
  toolGroup.setToolActive(toolName, {
    bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }],
  });
}

// ---------------------------------------------------------------------------
// Mask editing — brush/eraser over the segmentation labelmap, undo/redo via
// Cornerstone's history, and export of the edited labelmap for download.
// ---------------------------------------------------------------------------

// The segment the brush paints. Module-level so setVisibilities can restore it
// (its loop clobbers the active segment index).
let _activeEditSegment = 1;

export function hasSegmentation(): boolean {
  return !!cache.getVolume(segmentationId);
}

// Hand the primary button to the brush or eraser, or pass null to release it
// (the caller then restores measurement/navigation ownership).
export function setActiveMaskEditTool(toolName: MaskEditToolName | null) {
  const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
  if (!toolGroup) return;
  for (const name of EDIT_TOOL_NAMES) toolGroup.setToolDisabled(name);
  if (!toolName) return;
  toolGroup.setToolDisabled(CrosshairsTool.toolName);
  toolGroup.setToolDisabled(PanTool.toolName);
  for (const name of MEASUREMENT_TOOL_NAMES) toolGroup.setToolPassive(name);
  toolGroup.setToolActive(toolName, {
    bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }],
  });
}

export function setActiveEditSegment(segmentIndex: number) {
  _activeEditSegment = segmentIndex;
  try {
    segmentation.segmentIndex.setActiveSegmentIndex(segmentationId, segmentIndex);
  } catch {
    /* segmentation not loaded yet */
  }
}

// Brush radius in world mm (applies to both the brush and eraser instances).
export function setMaskBrushSize(mm: number) {
  try {
    cornerstoneTools.utilities.segmentation.setBrushSizeForToolGroup(toolGroupId, mm);
  } catch {
    /* tool group not ready */
  }
}

// Cornerstone records every labelmap stroke AND every measurement draw/edit as a
// memo on the same shared history — so these double as the global viewer undo/redo.
export function undoMaskEdit() {
  csCoreUtils.HistoryMemo.DefaultHistoryMemo.undo();
  currentRenderingEngine?.render();
}

export function redoMaskEdit() {
  csCoreUtils.HistoryMemo.DefaultHistoryMemo.redo();
  currentRenderingEngine?.render();
}

export function getMaskEditHistoryState(): { canUndo: boolean; canRedo: boolean } {
  const h = csCoreUtils.HistoryMemo.DefaultHistoryMemo;
  return { canUndo: h.canUndo, canRedo: h.canRedo };
}

// Fires whenever any stroke (or undo/redo of one) changes the labelmap.
export function subscribeToSegmentationEdits(cb: () => void): () => void {
  const handler = () => cb();
  eventTarget.addEventListener(
    csToolsEnums.Events.SEGMENTATION_DATA_MODIFIED,
    handler as EventListener
  );
  return () =>
    eventTarget.removeEventListener(
      csToolsEnums.Events.SEGMENTATION_DATA_MODIFIED,
      handler as EventListener
    );
}

export type LabelmapExport = {
  dimensions: number[];
  spacing: number[];
  origin: number[];
  /** Nine values, LPS world axes: i-axis [0..2], j-axis [3..5], k-axis [6..8]. */
  direction: number[];
  data: ArrayLike<number>;
};

// Current (possibly edited) labelmap + geometry, for the NIfTI download.
export function getSegmentationExport(): LabelmapExport | null {
  const volume = cache.getVolume(segmentationId);
  const vm = volume?.voxelManager;
  if (!volume || !vm) return null;
  let data: ArrayLike<number> | undefined;
  try {
    data = vm.getCompleteScalarDataArray?.();
  } catch {
    return null;
  }
  if (!data || !data.length) return null;
  return {
    dimensions: [...volume.dimensions],
    spacing: [...volume.spacing],
    origin: [...volume.origin],
    direction: [...volume.direction],
    data,
  };
}

// Remove only measurement annotations (and any magnify loupes), leaving the crosshair intact.
export function clearMeasurements() {
  try {
    const all = annotation.state.getAllAnnotations() ?? [];
    const names = [...MEASUREMENT_TOOL_NAMES, MAGNIFY_TOOL] as readonly string[];
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
  // ArrowAnnotate stores its note as free text, not cached stats.
  const text = a?.data?.text;
  if (typeof text === "string" && text.trim()) return text.trim();
  const statsByTarget = a?.data?.cachedStats ?? {};
  for (const stats of Object.values(statsByTarget) as any[]) {
    if (!stats || typeof stats !== "object") continue;
    // Bidirectional: long × short axis (RECIST-style).
    if (typeof stats.length === "number" && typeof stats.width === "number") {
      return `${formatNum(stats.length)} × ${formatNum(stats.width)} ${stats.unit ?? "mm"}`;
    }
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

// ---------------------------------------------------------------------------
// Cine playback — auto-scroll one MPR pane through its slices at a fixed frame
// rate (Cornerstone's cine utility natively supports volume viewports).
// ---------------------------------------------------------------------------

export type CinePane = "axial" | "sagittal" | "coronal";
const CINE_VIEWPORT_BY_PANE: Record<CinePane, string> = {
  axial: viewportId1,
  sagittal: viewportId2,
  coronal: viewportId3,
};

let _cineElement: HTMLDivElement | null = null;

export function startCine(pane: CinePane, fps = 12): boolean {
  const engine = getRenderingEngine(renderingEngineId);
  if (!engine) return false;
  stopCine(); // one clip at a time
  try {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- element isn't on IViewport */
    const viewport = engine.getViewport(CINE_VIEWPORT_BY_PANE[pane]) as any;
    const element = viewport?.element as HTMLDivElement | undefined;
    if (!element) return false;
    cornerstoneTools.utilities.cine.playClip(element, { framesPerSecond: fps, loop: true });
    _cineElement = element;
    return true;
  } catch (e) {
    console.warn("Cine playback unavailable:", e);
    return false;
  }
}

export function stopCine() {
  if (!_cineElement) return;
  try {
    cornerstoneTools.utilities.cine.stopClip(_cineElement);
  } catch {
    /* viewport already torn down */
  }
  _cineElement = null;
}

// Undo any oblique-plane rotation / slab thickness back to standard orthogonal
// axial/sagittal/coronal (the crosshair's rotation handles create oblique planes;
// this is the way back). Also recenters and resets zoom/pan on all three panes.
export function resetMprOrientation() {
  const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
  const tool = toolGroup?.getToolInstance(CrosshairsTool.toolName) as
    | { resetCrosshairs?: () => void }
    | undefined;
  try {
    tool?.resetCrosshairs?.();
  } catch {
    /* crosshair tool not active/ready */
  }
  currentRenderingEngine?.render();
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

// ---------------------------------------------------------------------------
// Progressive resolution upgrade — stream the full-res CT in the background
// and hot-swap it into the MPR viewports without a page reload. Cameras are
// preserved; the labelmap representation must be rebuilt because setVolumes
// replaces every volume actor on the viewport.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any -- optional cornerstone APIs probed at runtime */
async function _rebuildSegmentationRepresentations() {
  if (!_lastColorLUT || !cache.getVolume(segmentationId)) return;
  for (const viewportId of MPR_VIEWPORT_IDS) {
    try {
      // Drop the (now actor-less) representation entry first so re-adding isn't a no-op.
      (segmentation as any).removeSegmentationRepresentations?.(viewportId, {
        segmentationId,
        type: csToolsEnums.SegmentationRepresentations.Labelmap,
      });
    } catch {
      /* nothing to remove */
    }
    await segmentation.addSegmentationRepresentations(viewportId, [
      {
        segmentationId,
        type: csToolsEnums.SegmentationRepresentations.Labelmap,
        config: { colorLUTOrIndex: _lastColorLUT },
      },
    ]);
    segmentation.activeSegmentation.setActiveSegmentation(viewportId, segmentationId);
  }
}

/**
 * Load the given full-res CT and swap it into every viewport in place.
 * Returns the new volumeId, or null on failure (caller keeps the current
 * volume — nothing is torn down until the new one is fully loaded).
 */
export async function upgradeCtVolume(fullResCtUrl: string): Promise<string | null> {
  const engine = currentRenderingEngine;
  if (!engine) return null;
  try {
    const imageIds = await createNiftiImageIdsAndCacheMetadata({ url: fullResCtUrl });
    const newVolumeId = `ctVolume-hd-${Date.now()}`;
    const volume = await volumeLoader.createAndCacheVolume(newVolumeId, { imageIds });
    await volume.load();

    // Preserve each pane's camera so the swap is visually seamless.
    const cameras = new Map<string, unknown>();
    for (const viewportId of MPR_VIEWPORT_IDS) {
      try {
        cameras.set(viewportId, engine.getViewport(viewportId).getCamera());
      } catch {
        /* viewport gone — skip */
      }
    }
    await setVolumesForViewports(engine, [{ volumeId: newVolumeId }], MPR_VIEWPORT_IDS);
    for (const viewportId of MPR_VIEWPORT_IDS) {
      const camera = cameras.get(viewportId);
      if (!camera) continue;
      try {
        engine.getViewport(viewportId).setCamera(camera as never);
      } catch {
        /* keep the reset camera */
      }
    }
    await _rebuildSegmentationRepresentations();

    // The shaded 3D volume view renders its own private copy of the CT (never the
    // shared volume — see _volume3DCopyId), so there is nothing to re-target here.
    // If it's open it keeps its current copy; the next open copies the new volume.

    _currentCtVolumeId = newVolumeId;
    engine.renderViewports([...MPR_VIEWPORT_IDS]);
    return newVolumeId;
  } catch (e) {
    console.warn("Full-res upgrade failed; keeping the current volume.", e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Shaded GPU volume rendering ("Volume" mode in the 3D pane): ray-cast VTK.js
// rendering of the CT itself with clinical transfer-function presets, driven
// by a trackball camera. Works with or without a segmentation (local DICOM).
// ---------------------------------------------------------------------------

// Curated subset of Cornerstone's VTK presets that read well on CT.
export const VOLUME_3D_PRESETS = [
  { name: "CT-Bone", label: "Bone" },
  { name: "CT-AAA", label: "Angio" },
  { name: "CT-Chest-Contrast-Enhanced", label: "Chest" },
  { name: "CT-Lung", label: "Lung" },
  { name: "CT-Soft-Tissue", label: "Soft tissue" },
  { name: "CT-MIP", label: "MIP" },
] as const;

// MR intensities aren't Hounsfield units, so the CT transfer functions above
// render MR as an opaque slab. Cornerstone ships MR presets — the viewer offers
// these instead when the loaded volume is MR (local DICOM can be any modality).
export const VOLUME_3D_PRESETS_MR = [
  { name: "MR-Default", label: "Default" },
  { name: "MR-Angio", label: "Angio" },
  { name: "MR-MIP", label: "MIP" },
  { name: "MR-T2-Brain", label: "T2 Brain" },
] as const;

// Modality of the volume the viewer is showing (DICOM metadata; NIfTI dataset
// cases have no Modality and return undefined — they're CT by construction).
export function getCurrentVolumeModality(): string | undefined {
  if (!_currentCtVolumeId) return undefined;
  return (cache.getVolume(_currentCtVolumeId) as any)?.metadata?.Modality;
}

let _lastVolume3DPreset: string = VOLUME_3D_PRESETS[0].name;

// The 3D pane's private copy of the CT volume. A cached volume owns exactly ONE
// vtkStreamingOpenGLTexture, which stores a single GL context + texture handle —
// so a volume can only ever be rendered by ONE engine. Sharing the MPR volumeId
// with the 3D engine makes the two contexts fight over that texture: the 3D pane
// stays black (its frames were "already uploaded" — into the MPR context) and the
// next MPR render draws the CT through a foreign handle (black CT, labelmap only).
let _volume3DCopyId: string | null = null;

async function _getOrCreateVolume3DCopy(sourceVolumeId: string): Promise<string | null> {
  const copyId = `${sourceVolumeId}-vr3d`;
  if (cache.getVolume(copyId)) return copyId;
  try {
    const source = cache.getVolume(sourceVolumeId) as any;
    let scalarData = source?.voxelManager?.getCompleteScalarDataArray?.();
    if (!scalarData?.length && Array.isArray(source?.imageIds) && source.imageIds.length) {
      // DICOM (wadouri) volumes stream frames straight onto the GPU texture and can
      // drop their per-slice images from the IMAGE cache — getCompleteScalarDataArray
      // then finds no images and silently returns an EMPTY array ("Number of
      // components 0 must be 1, 3 or 4" downstream). Re-decode the slices through the
      // image loader (the parsed datasets are still cached) and assemble the buffer.
      // Sequential on purpose: don't flood the decode workers on big series.
      const [w, h] = source.dimensions;
      const sliceLen = w * h;
      const slices: any[] = [];
      for (const imageId of source.imageIds) {
        slices.push(await imageLoader.loadAndCacheImage(imageId));
      }
      const pixelsOf = (img: any) =>
        img?.voxelManager?.getScalarData?.() ?? img?.getPixelData?.();
      const first = pixelsOf(slices[0]);
      if (first?.length) {
        const Ctor = first.constructor as new (n: number) => typeof first;
        scalarData = new Ctor(sliceLen * source.dimensions[2]);
        slices.forEach((img, i) => {
          const px = pixelsOf(img);
          if (px?.length) scalarData.set(px.subarray(0, sliceLen), i * sliceLen);
        });
      }
    }
    if (!scalarData?.length) return null;
    (volumeLoader.createLocalVolume as any)(copyId, {
      metadata: source.metadata,
      dimensions: source.dimensions,
      spacing: source.spacing,
      origin: source.origin,
      direction: source.direction,
      scalarData,
    });
    return copyId;
  } catch (e) {
    console.warn("Volume rendering: could not create the 3D volume copy.", e);
    return null;
  }
}

export function applyVolume3DPreset(presetName: string) {
  _lastVolume3DPreset = presetName;
  const engine = getRenderingEngine(volume3DEngineId) as RenderingEngine | undefined;
  if (!engine) return;
  try {
    const viewport = engine.getViewport(volume3DViewportId) as any;
    viewport?.setProperties?.({ preset: presetName });
    viewport?.render?.();
  } catch {
    /* 3D view not enabled */
  }
}

// Resolve once the element has a non-zero layout size (up to ~500ms), so the
// on-screen canvas Cornerstone allocates isn't 0×0 (a classic "black 3D pane").
function _waitForLayout(element: HTMLElement): Promise<boolean> {
  return new Promise((resolve) => {
    let tries = 0;
    const check = () => {
      if (element.offsetWidth > 0 && element.offsetHeight > 0) return resolve(true);
      if (tries++ > 30) return resolve(element.offsetWidth > 0);
      requestAnimationFrame(check);
    };
    check();
  });
}

export async function enableVolume3D(
  element: HTMLDivElement,
  presetName: string = _lastVolume3DPreset
): Promise<boolean> {
  if (!_currentCtVolumeId || !cache.getVolume(_currentCtVolumeId)) return false;
  try {
    try {
      cornerstoneTools.addTool(TrackballRotateTool);
    } catch {
      /* already registered */
    }
    await _waitForLayout(element);

    // Never hand the MPR volume to this engine — render a private copy with its
    // own GL texture (see the note by _volume3DCopyId).
    const copyId = await _getOrCreateVolume3DCopy(_currentCtVolumeId);
    if (!copyId) return false;
    _volume3DCopyId = copyId;

    // Dedicated engine — never share the MPR engine (see the note by its id).
    const engine = _getVolume3DEngine();
    engine.enableElement({
      viewportId: volume3DViewportId,
      type: Enums.ViewportType.VOLUME_3D,
      element,
      defaultOptions: {
        orientation: Enums.OrientationAxis.CORONAL,
        background: [0.03, 0.035, 0.043],
      },
    });
    const viewport = engine.getViewport(volume3DViewportId) as any;
    // Canonical VOLUME_3D recipe: attach the volume, THEN the preset (setPreset
    // no-ops if the volume actor isn't present yet), then frame + render.
    await viewport.setVolumes([{ volumeId: copyId }]);
    viewport.setProperties({ preset: presetName });
    _lastVolume3DPreset = presetName;
    // Match the on-screen canvas to the (now laid-out) element before framing.
    engine.resize(true, false);
    viewport.resetCamera();
    viewport.render();

    // If no volume actor attached, ray casting will just show black — report
    // failure so the UI can fall back to a message instead of a blank pane.
    const actorCount = viewport.getActors?.().length ?? 0;
    if (actorCount === 0) {
      console.warn("Volume rendering: no volume actor attached.");
      return false;
    }

    ToolGroupManager.destroyToolGroup(volume3DToolGroupId); // stale viewport ref from a prior open
    const toolGroup = ToolGroupManager.createToolGroup(volume3DToolGroupId);
    if (!toolGroup) return false;
    toolGroup.addTool(TrackballRotateTool.toolName);
    toolGroup.addTool(ZoomTool.toolName);
    toolGroup.addTool(PanTool.toolName);
    toolGroup.setToolActive(TrackballRotateTool.toolName, {
      bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }],
    });
    toolGroup.setToolActive(ZoomTool.toolName, {
      bindings: [{ mouseButton: csToolsEnums.MouseBindings.Wheel }],
    });
    toolGroup.setToolActive(PanTool.toolName, {
      bindings: [{ mouseButton: csToolsEnums.MouseBindings.Auxiliary }],
    });
    toolGroup.addViewport(volume3DViewportId, volume3DEngineId);
    viewport.render();
    return true;
  } catch (e) {
    console.warn("Volume rendering unavailable:", e);
    return false;
  }
}

export function disableVolume3D() {
  try {
    ToolGroupManager.destroyToolGroup(volume3DToolGroupId);
  } catch {
    /* tool group already gone */
  }
  // Destroy the whole dedicated engine so its canvas/GL context is released and
  // the next open starts clean. This can't touch the MPR engine.
  try {
    (getRenderingEngine(volume3DEngineId) as RenderingEngine | undefined)?.destroy();
  } catch {
    /* engine already gone */
  }
  // Free the private CT copy (CPU + GPU); reopening the pane rebuilds it.
  // createLocalVolume backs the copy with PER-SLICE images in the IMAGE cache
  // (`<copyId>_slice_<i>`), and removeVolumeLoadObject only deletes the volume
  // entry — it leaves those slice images allocated. Without freeing them too,
  // every Meshes→Volume round trip leaks a full CT copy until the next
  // createLocalVolume fails its cache-size check and the pane reports "volume
  // rendering isn't available" even though the GPU is fine.
  try {
    if (_volume3DCopyId) {
      const copyVolume = cache.getVolume(_volume3DCopyId);
      const sliceImageIds: string[] = copyVolume?.imageIds ?? [];
      cache.removeVolumeLoadObject(_volume3DCopyId);
      for (const imageId of sliceImageIds) {
        try {
          cache.removeImageLoadObject(imageId, { force: true });
        } catch {
          /* slice already evicted */
        }
      }
    }
  } catch {
    /* already evicted */
  }
  _volume3DCopyId = null;
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