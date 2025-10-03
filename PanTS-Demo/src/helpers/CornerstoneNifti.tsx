import {
  Enums,
  RenderingEngine,
  cache,
  init as csInit,
  getRenderingEngine,
  setVolumesForViewports,
  volumeLoader
} from '@cornerstonejs/core';
import {
  PanTool,
  SegmentationDisplayTool,
  StackScrollMouseWheelTool,
  ToolGroupManager,
  ZoomTool,
  addTool,
  state as csToolState,
  init as csTools3dInit,
  Enums as csToolsEnums,
  segmentation
} from '@cornerstonejs/tools';

import type { ColorLUT } from '@cornerstonejs/core/dist/types/types';
import { cornerstoneNiftiImageVolumeLoader } from '@cornerstonejs/nifti-volume-loader';
import type { VisualizationRenderReturnType } from '../types';
import { APP_CONSTANTS } from './constants';
import { getPanTSId } from './utils';

const toolGroupId = "myToolGroup";
const renderingEngineId = "myRenderingEngine";
const segmentationId = "combined_labels";

const DEFAULT_SEGMENTATION_CONFIG = {
  fillAlpha: APP_CONSTANTS.DEFAULT_SEGMENTATION_OPACITY,
  fillAlphaInactive: APP_CONSTANTS.DEFAULT_SEGMENTATION_OPACITY,
  outlineOpacity: 1,
  outlineWidth: 1,
  renderOutline: false,
  outlineOpacityInactive: 0
};

const toolGroupSpecificRepresentationConfig = {
  renderInactiveSegmentations: true,
  representations: {
    [csToolsEnums.SegmentationRepresentations.Labelmap]: DEFAULT_SEGMENTATION_CONFIG
  },
};
const viewportId1 = 'CT_NIFTI_AXIAL';
const viewportId2 = 'CT_NIFTI_SAGITTAL';
const viewportId3 = 'CT_NIFTI_CORONAL';

export async function renderVisualization(ref1: HTMLDivElement | null, ref2: HTMLDivElement | null, ref3: HTMLDivElement | null, convertedColorLUT: ColorLUT, clabelId: string, setLoading: React.Dispatch<React.SetStateAction<boolean>>): Promise<VisualizationRenderReturnType | undefined> {
  cache.purgeCache();
  csTools3dInit();
  await csInit();
  if (!ref1 || !ref2 || !ref3) {
    return;
  };
  ref1.oncontextmenu = (e) => e.preventDefault();
  ref2.oncontextmenu = (e) => e.preventDefault();
  ref3.oncontextmenu = (e) => e.preventDefault();
  
  const toolGroup = createToolGroup();
  if (!toolGroup) return;
  volumeLoader.registerVolumeLoader('nifti', cornerstoneNiftiImageVolumeLoader);
  const renderingEngine = createRenderingEngine();

  // const mainNiftiURL = `${APP_CONSTANTS.API_ORIGIN}/api/get-main-nifti/${clabelId}`;
  const pants_id = getPanTSId(clabelId);
  const mainNiftiURL = `https://huggingface.co/datasets/BodyMaps/iPanTSMini/resolve/main/image_only/${pants_id}/ct.nii.gz?download=true`
  const volumeId = 'nifti:' + mainNiftiURL;

  
  const volume = await volumeLoader.createAndCacheVolume(volumeId);
  await volume.load(); // ✅ 真正加载数据

    
  const segmentationURL = `${APP_CONSTANTS.API_ORIGIN}/api/get-segmentations/${clabelId}`;
  const combined_labels_Id = 'nifti:' + segmentationURL;
  const combined_labels = await volumeLoader.createAndCacheVolume(combined_labels_Id);
  setLoading(false);
  const segmentationVolumeArray = combined_labels.getScalarData(); // ✅ 加这一句

  //const colorLUT = [];
  // Fill the colorLUT array with your custom colors
  //Object.keys(APP_CONSTANTS.cornerstoneCustomColorLUT).forEach(value => {
  //  colorLUT[value] = APP_CONSTANTS.cornerstoneCustomColorLUT[value];
  //});

  
  // const colorLUTResponse = await fetch(`${APP_CONSTANTS.API_ORIGIN}/api/get-label-colormap/${clabelId}`);
  // //console.log("✅8686 Raw colorLUT = ", colorLUT);
  // const colorLUT = await colorLUTResponse.json();

  // console.log("✅ Raw colorLUT = ", JSON.stringify(colorLUT, null, 2));

  // // 转换为 Cornerstone 支持的 array 格式
  // const convertedColorLUT: ColorLUT = [];

  // // 先确定最大 labelId，用于后续填补空位
  // const labelIds = Object.keys(colorLUT).map(id => parseInt(id));
  // const maxLabelId = Math.max(...labelIds);

  // // 默认填满数组，防止稀疏索引（比如 0 没定义会是 empty slot）
  // for (let i = 0; i <= maxLabelId; i++) {
  //   convertedColorLUT[i] = [0, 0, 0, 0];  // 默认透明黑色，可按需调整
  // }

  // for (const rawLabelId in colorLUT) {
  //   const labelId = parseInt(rawLabelId);
  //   const color = colorLUT[rawLabelId];

  //   if (!color) {
  //     console.warn(`❗ Label ${labelId} has no color value`);
  //     continue;
  //   }

  //   const r = color.R;
  //   const g = color.G;
  //   const b = color.B;
  //   const a = color.A ?? 255;

  //   if ([r, g, b].some(v => v === undefined)) {
  //     console.warn(`❗ Invalid color format for label ${labelId}:`, color);
  //     continue;
  //   }

  //   // 覆盖默认值
  //   convertedColorLUT[labelId] = [r, g, b, a];
  //   console.log(`✅ Label ${labelId}: RGB(${r}, ${g}, ${b}), A: ${a}`);
  // }

  console.log("✅ convertedColorLUT = ", convertedColorLUT);


  //console.log("✅ corner Raw colorLUT = ", JSON.stringify(colorLUT, null, 2));
  const viewportInputArray = [
      {
        viewportId: viewportId1, 
        type: Enums.ViewportType.ORTHOGRAPHIC,
        element: ref1,
        defaultOptions: {
          orientation: Enums.OrientationAxis.AXIAL,
        },
      },
      {
        viewportId: viewportId2,
        type: Enums.ViewportType.ORTHOGRAPHIC,
        element: ref2,
        defaultOptions: {
          orientation: Enums.OrientationAxis.SAGITTAL,
        },
      },
      {
        viewportId: viewportId3,
        type: Enums.ViewportType.ORTHOGRAPHIC,
        element: ref3, 
        defaultOptions: {
          orientation: Enums.OrientationAxis.CORONAL,
        },
      },
    ];

  renderingEngine.setViewports(viewportInputArray);
  
  toolGroup.addViewport(viewportId1, renderingEngineId);
  toolGroup.addViewport(viewportId2, renderingEngineId);
  toolGroup.addViewport(viewportId3, renderingEngineId);

  setVolumesForViewports(
      renderingEngine,
      [{ volumeId }],
      [viewportId1, viewportId2, viewportId3]
  );

  const initialWindowWidth = 50;
  const initialWindowCenter = 500;

  viewportInputArray.forEach(({ viewportId }) => {
    const viewport = renderingEngine.getViewport(viewportId);
    try {
      // @ts-expect-error setProperties does not exist
      viewport.setProperties({ 
        voiRange: {
          windowWidth: initialWindowWidth,
          windowCenter: initialWindowCenter,
        },
      });
    } catch (e) {
      console.warn("[VOI Error]", e);
    }
  });

  renderingEngine.render();

  segmentation.state.removeSegmentation(segmentationId);
  segmentation.addSegmentations([{
    segmentationId: segmentationId, 
    representation: {
      type: csToolsEnums.SegmentationRepresentations.Labelmap,
      data:{
        volumeId: combined_labels_Id,
      },
    },
  }]);

  const segRepUIDs = await segmentation.addSegmentationRepresentations(
    toolGroupId, 
    [{
      segmentationId: segmentationId, 
      type: csToolsEnums.SegmentationRepresentations.Labelmap,
      options: {
        colorLUTOrIndex: convertedColorLUT,
      }, 
    }],toolGroupSpecificRepresentationConfig );
  return {
    segRepUIDs,
    renderingEngine,
    viewportIds: [viewportId1, viewportId2, viewportId3],
    volumeId,
    segmentationVolumeArray,
  };
  
}



function addToolsToCornerstone(){
  const addedTools = csToolState.tools;
  if (!addedTools.StackScrollMouseWheel) addTool(StackScrollMouseWheelTool);
  if (!addedTools.SegmentationDisplay) addTool(SegmentationDisplayTool);
  if (!addedTools.Zoom) addTool(ZoomTool);
  if (!addedTools.Pan) addTool(PanTool);
}

function createToolGroup(){
  addToolsToCornerstone();
  ToolGroupManager.destroyToolGroup(toolGroupId);
  const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);

  if (!toolGroup) return;

  toolGroup.addTool(StackScrollMouseWheelTool.toolName);
  toolGroup.addTool(SegmentationDisplayTool.toolName);
  toolGroup.addTool(ZoomTool.toolName);
  toolGroup.addTool(PanTool.toolName);

  toolGroup.setToolActive(StackScrollMouseWheelTool.toolName);
  toolGroup.setToolEnabled(SegmentationDisplayTool.toolName);

  toolGroup.setToolActive(PanTool.toolName, {
    bindings: [{mouseButton: csToolsEnums.MouseBindings.Primary}],
  });

  toolGroup.setToolActive(ZoomTool.toolName, {
    bindings: [{ mouseButton: csToolsEnums.MouseBindings.Secondary}],
  });
  return toolGroup;
} 
/*
function createRenderingEngine(){
  let renderingEngine = getRenderingEngine(renderingEngineId);
  if (renderingEngine){
    renderingEngine.destroy();  
    renderingEngine = new RenderingEngine(renderingEngineId); 
  } else {
    renderingEngine = new RenderingEngine(renderingEngineId); 
  }
  return renderingEngine;
}
*/

let currentRenderingEngine: RenderingEngine | null = null; 

function createRenderingEngine() {
  console.log("[createRenderingEngine] called");
  if (currentRenderingEngine) {
    try {
      currentRenderingEngine.destroy();
      console.log("✅ Destroyed previous renderingEngine");
    } catch (err) {
      console.warn("⚠️ Failed to destroy old renderingEngine:", err);
    }
    currentRenderingEngine = null;
  }

  const newEngine = new RenderingEngine(renderingEngineId);
  
  currentRenderingEngine = newEngine;
  return newEngine;
}   



export function setVisibilities(segRepUIDs: string[], checkState: boolean[]){
  const uid = segRepUIDs[0];
  for (let i = 1; i < checkState.length; i++){
    segmentation.config.visibility.setSegmentVisibility(toolGroupId, uid, i, checkState[i]);
  }
};

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


export function setToolGroupOpacity(opacityValue: number){
  const newSegConfig = { ...DEFAULT_SEGMENTATION_CONFIG };
  newSegConfig.fillAlpha = opacityValue;
  newSegConfig.fillAlphaInactive = opacityValue;
  newSegConfig.outlineOpacity = opacityValue;
  newSegConfig.outlineOpacityInactive = opacityValue;

  const newToolGroupConfig = {
    renderInactiveSegmentations: true,
    representations: {
      [csToolsEnums.SegmentationRepresentations.Labelmap]: newSegConfig
    },
  };

  segmentation.config.setToolGroupSpecificConfig(toolGroupId, newToolGroupConfig);
}
