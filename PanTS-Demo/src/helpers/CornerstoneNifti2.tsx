import { init as coreInit, Enums, getRenderingEngine, imageLoader, RenderingEngine, setVolumesForViewports, volumeLoader } from "@cornerstonejs/core";
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
    PanTool,
    ZoomTool,
    StackScrollTool,
    CrosshairsTool,
} = cornerstoneTools;

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
export async function renderVisualization(ref1: HTMLDivElement, ref2: HTMLDivElement, ref3: HTMLDivElement, convertedColorLUT: ColorLUT, ctUrl: string, segUrl: string, setLoading: React.Dispatch<React.SetStateAction<boolean>>) {
    coreInit();
    niftiImageLoaderInit();
    cornerstoneToolsInit();

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
    toolGroup.addTool(PanTool.toolName);
    toolGroup.addTool(ZoomTool.toolName);
    toolGroup.addTool(StackScrollTool.toolName);
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
    if (currentRenderingEngine) {
        currentRenderingEngine.destroy();
        currentRenderingEngine = null;
    }

    const renderingEngine = new RenderingEngine(renderingEngineId);
    currentRenderingEngine = renderingEngine;

    imageLoader.registerImageLoader("nifti", cornerstoneNiftiImageLoader);
    const imageIds = await createNiftiImageIdsAndCacheMetadata({ url: mainNiftiURL });
    const segmentationImageIds = await createNiftiImageIdsAndCacheMetadata({ url: segmentationURL });

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
    toolGroup.setToolActive(PanTool.toolName, {
        bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }]
    })
    toolGroup.setToolActive(StackScrollTool.toolName, {
        bindings: [{ mouseButton: csToolsEnums.MouseBindings.Wheel }]
    })

    renderingEngine.setViewports(viewportInputArray);

    const volume = await volumeLoader.createAndCacheVolume(volumeId, { imageIds });
    await volume.load();
    await setVolumesForViewports(
        renderingEngine,
        [{ volumeId }],
        viewportInputArray.map((viewport) => viewport.viewportId)
    );

    renderingEngine.renderViewports(viewportInputArray.map((viewport) => viewport.viewportId));

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
    })

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
        segmentation.segmentIndex.setActiveSegmentIndex(segmentationId, i);
        segmentation.config.visibility.setSegmentIndexVisibility(viewportId1, { segmentationId: segmentationId, type: csToolsEnums.SegmentationRepresentations.Labelmap }, i, checkState[i]);
        segmentation.config.visibility.setSegmentIndexVisibility(viewportId2, { segmentationId: segmentationId, type: csToolsEnums.SegmentationRepresentations.Labelmap }, i, checkState[i]);
        segmentation.config.visibility.setSegmentIndexVisibility(viewportId3, { segmentationId: segmentationId, type: csToolsEnums.SegmentationRepresentations.Labelmap }, i, checkState[i]);
        // console.log(segmentation.config.visibility.getSegmentIndexVisibility(viewportId1, { segmentationId: segmentationId, type: csToolsEnums.SegmentationRepresentations.Labelmap }, i));
        if (currentRenderingEngine) {
            currentRenderingEngine.renderViewports([viewportId1, viewportId2, viewportId3]);
            currentRenderingEngine.render();
        }
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
        fillAlpha: opacityValue,
        fillAlphaInactive: opacityValue,
        outlineOpacity: opacityValue,
        outlineOpacityInactive: opacityValue,

    });
    if (currentRenderingEngine) {
        currentRenderingEngine.renderViewports([viewportId1, viewportId2, viewportId3]);
        currentRenderingEngine.render();
    }
}

export function toggleCrosshairTool(value: boolean) {
  const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
  if (!toolGroup) return;
  if (!value) {
    toolGroup.setToolActive(CrosshairsTool.toolName, {
      bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }],
    });

    toolGroup.setToolDisabled(PanTool.toolName);
    return;
  }
  if (value) {
    toolGroup.setToolDisabled(CrosshairsTool.toolName);
    toolGroup.setToolActive(PanTool.toolName, {
      bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }],
    });
  }
}

export function setZoom(zoomValue: number){
  const engine = getRenderingEngine(renderingEngineId);
  [viewportId1, viewportId2, viewportId3].forEach((viewportId) => {
      if (engine){
        const viewport = engine.getViewport(viewportId);
        viewport.setZoom(zoomValue);
        console.log(viewport.getZoom());
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
  console.log(toolGroup.getToolInstance(CrosshairsTool.toolName).toolCenter);
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