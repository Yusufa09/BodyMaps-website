import type { Color } from '@cornerstonejs/core/dist/types/types';
import { Niivue, NVImage, SLICE_TYPE } from '@niivue/niivue';
import type { NColorMap } from '../types';
import { APP_CONSTANTS } from './constants';



export async function create3DVolume(canvasRef: React.RefObject<HTMLCanvasElement | null>, clabelId: string, colorLUT: {[key: number]: Color}): Promise<{nv: Niivue, nvImage: NVImage | null, cmapCopy: NColorMap}> {
  console.log(clabelId)
  
  const nv = new Niivue({
    sliceType: SLICE_TYPE.RENDER, 
  });
  nv.setInterpolation(true);

  nv.mouseMove = (x: number, y: number): void => {
    x *= nv.uiData.dpr!
    y *= nv.uiData.dpr!
    const dx = (x - nv.mousePos[0]) / nv.uiData.dpr!
    const dy = (y - nv.mousePos[1]) / nv.uiData.dpr!
    nv.mousePos = [x, y]
    if (nv.inRenderTile(x, y) < 0) {
      return
    }

    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
      return
    }
    nv.scene.renderAzimuth += dx * 0.5;
    nv.scene.renderElevation += dy * 0.5;

    nv.drawScene()
  }



  console.log(nv.getCurrentDragMode()); 

  if (!canvasRef.current) return { nv, nvImage: null, cmapCopy: {R: [], G: [], B: [], I: [], A: []} };
  nv.attachToCanvas(canvasRef.current);

  const nvImage = await NVImage.loadFromUrl({
    name: "combined_labels.nii.gz",
    url: `${APP_CONSTANTS.API_ORIGIN}/api/get-segmentations/${clabelId}`,
  });

  const labelIds = Object.keys(colorLUT).map(id => parseInt(id));
  const maxLabelId = Math.max(...labelIds);

  const R = Array(maxLabelId + 1).fill(0);
  const G = Array(maxLabelId + 1).fill(0);
  const B = Array(maxLabelId + 1).fill(0);
  const A = Array(maxLabelId + 1).fill(0);
  const I = Array(maxLabelId + 1).fill(0);

  for (const rawLabelId in colorLUT) {
    const labelId = parseInt(rawLabelId);
    const color = colorLUT[rawLabelId];
  
    if (!color || [color[0], color[1], color[2]].some(v => v === undefined)) {
      console.warn(`❗ Invalid color for label ${labelId}`);
      continue;
    }
    R[labelId] = color[0];
    G[labelId] = color[1];
    B[labelId] = color[2];
    A[labelId] = color[3] ?? 128;
    I[labelId] = labelId;
  }
  const cmapCopy = {
    R: R,
    G: G,
    B: B,
    A: A,
    I: I
  }
  


  nvImage.setColormapLabel({
    R: R,
    G: G,
    B: B,
    A: A,
    I: I
  });
  // 1. 添加图像
  nv.addVolume(nvImage);

  // 3. 设置 label colormap 数据
  nvImage.setColormapLabel({
    R: R,
    G: G,
    B: B,
    A: A,
    I: I
  });
  
  nvImage.colormap = "";

  nv.updateGLVolume();
  nv.drawScene();
//   const uniqueVals = [...new Set(nvImage.img)];



  console.log('✅ Niivue volume created');
  return {
    nv,
    nvImage: null,
    cmapCopy
  };
  
}


export function updateVisibilities(nv: Niivue, checkState: boolean[], _sessionId: string | undefined, cmapCopy: NColorMap | null) {
  if (!(nv.volumes && checkState && cmapCopy)) {
    console.warn("❌ updateVisibilities skipped: volumes or checkState undefined");
    return;
  }

  const nvImage = nv.volumes[0];

  const cmap = {
    R: [...cmapCopy.R],
    G: [...cmapCopy.G],
    B: [...cmapCopy.B],
    A: [...cmapCopy.A],
    I: [...cmapCopy.I]
  };

  console.log("🔧 updateVisibilities: applying visibility mask for", checkState);

  for (let i = 1; i < checkState.length; i++) {
    if (checkState[i] === false) {
      cmap.A[i] = 0;
    }
  }

  nvImage.setColormapLabel(cmap);
  nv.updateGLVolume();
  nv.drawScene();
}


// export function updateGeneralOpacity(canvasRef: React.RefObject<HTMLCanvasElement | null>, opacityValue: number){ //for all volumes, continuous opacity values
//   if (canvasRef.current)  {
//     canvasRef.current.style.opacity = opacityValue.toString();
//   }
// }
    
