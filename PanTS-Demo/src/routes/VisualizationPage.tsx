import type { RenderingEngine } from '@cornerstonejs/core';
import type { Color, ColorLUT, IImageVolume } from '@cornerstonejs/core/dist/types/types';
import { Niivue } from '@niivue/niivue';
import { IconDownload, IconHome, IconReport, IconSettings } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import RotatingModelLoader from '../components/Loading';
import OpacitySlider from '../components/OpacitySlider/OpacitySlider';
import OrganCheckbox from '../components/OrganCheckbox';
import ReportScreen from '../components/ReportScreen/ReportScreen';
import WindowingSlider from '../components/WindowingSlider/WindowingSlider';
import { renderVisualization, setToolGroupOpacity, setVisibilities } from '../helpers/CornerstoneNifti';
import { create3DVolume, updateVisibilities } from '../helpers/NiiVueNifti';
import { API_BASE, APP_CONSTANTS, segmentation_categories, segmentation_category_colors } from '../helpers/constants';
import { filenameToName } from '../helpers/utils';
import { type CheckBoxData, type LastClicked, type NColorMap } from '../types';
import './VisualizationPage.css';

function VisualizationPage() {
  // References and state
  const params = useParams();
  const pantsCase = params.caseId ?? '1';
  
  const axial_ref = useRef<HTMLDivElement>(null);
  const sagittal_ref = useRef<HTMLDivElement>(null);
  const coronal_ref = useRef<HTMLDivElement>(null);
  const render_ref = useRef<HTMLCanvasElement>(null);
  const cmapRef = useRef<NColorMap>(null);
  // const TaskMenu_ref = useRef(null);
  const VisualizationContainer_ref = useRef(null);
  const segmentationRef = useRef<IImageVolume>(null);
//   const lastClickInfoRef = useRef(null);

//   const [sliceAxial, setSliceAxial] = useState(0);
//   const [sliceSagittal, setSliceSagittal] = useState(0);
//   const [sliceCoronal, setSliceCoronal] = useState(0);
  const [checkState, setCheckState] = useState<boolean[]>([true]);
  const [segmentationRepresentationUIDs, setSegmentationRepresentationUIDs] = useState<string[] | null>(null);
  const [NV, setNV] = useState<Niivue | undefined>();
  const [sessionKey, _setSessionKey] = useState<string | undefined>(undefined);
  const [checkBoxData, setCheckBoxData] = useState<CheckBoxData[]>([]);
  const [opacityValue, setOpacityValue] = useState(APP_CONSTANTS.DEFAULT_SEGMENTATION_OPACITY * 100);
  const [windowWidth, setWindowWidth] = useState(400);
  const [windowCenter, setWindowCenter] = useState(50);
  const [renderingEngine, setRenderingEngine] = useState<RenderingEngine | null>(null);
  const [viewportIds, setViewportIds] = useState<string[]>([]);
  const [volumeId, setVolumeId] = useState<string | null>(null);
  const [showReportScreen, setShowReportScreen] = useState(false);
  const [_lastClicked, setLastClicked] = useState<LastClicked | null>(null);
  const [showTaskDetails, setShowTaskDetails] = useState(true);
  const [showOrganDetails, setShowOrganDetails] = useState(false);  
  const [loading, setLoading] = useState(true);
  const [labelColorMap, _setLabelColorMap] = useState<{ [key: number]: Color }>(segmentation_category_colors);


  


  const navigate = useNavigate();
  // const location = useLocation();

  // Load and render visualization on first render
  useEffect(() => {
    const setup = async () => {
      // const state = location.state;
      // if (!state) {
        // alert('No Nifti Files Uploaded!');
        // navigate('/');
        // return;
      // }



      const checkBoxData = segmentation_categories.map((filename, i) => ({
        label: filenameToName(filename),
        id: i + 1
      }));
      setCheckBoxData(checkBoxData);
      const initialState = [true];  // background 永远可见
      checkBoxData.forEach(item => {
        initialState[item.id] = true;
      });
      setCheckState(initialState);
      const max = Math.max(...Object.keys(labelColorMap).map((key) => parseInt(key)));

      const cmap: ColorLUT = Array.from({ length: max+1 }, () => [0, 0, 0, 0]);
      for (const key in labelColorMap) {
        cmap[parseInt(key)] = labelColorMap[parseInt(key)];
      }
      if (!axial_ref.current || !sagittal_ref.current || !coronal_ref.current || !render_ref.current || cmap.length === 0) return;


      const result =
        await renderVisualization(axial_ref.current, sagittal_ref.current, coronal_ref.current, cmap, pantsCase, setLoading);

      
      // setLoading(false);
      if (!result) return;
      const { segmentationVolumeArray, segRepUIDs, renderingEngine, viewportIds, volumeId } = result;

      setSegmentationRepresentationUIDs(segRepUIDs);
      setRenderingEngine(renderingEngine);
      setViewportIds(viewportIds);
      setVolumeId(volumeId);

      const { nv, cmapCopy } = await create3DVolume(render_ref, pantsCase, labelColorMap);
      cmapRef.current = cmapCopy;
      setNV(nv);
      segmentationRef.current = segmentationVolumeArray;
    };

    setup();
  }, [pantsCase, axial_ref, sagittal_ref, coronal_ref, render_ref, labelColorMap]);
  // Toggle checkbox state
  //   useEffect(() => {
  //   const fetchColorMap = async () => {
  //     try {
  //       // const cached = sessionStorage.getItem(cacheKey);
  //       // if (cached) {
  //       //   setLabelColorMap(JSON.parse(cached));
  //       //   return;
  //       // }
  //       setProgress(0.15)
  //       const response = await fetch(`${APP_CONSTANTS.API_ORIGIN}/api/get-label-colormap/${pantsCase}`);
  //       const lut = await response.json();
  //       const parsedMap: {[key: number]: Color}= {};
  //       for (const labelId in lut) {
  //         const color = lut[labelId];
  //         if (color && color.R !== undefined) {
  //           const arr: Color = [color.R, color.G, color.B, color.A ?? 255];
  //           parsedMap[Number(labelId)] = arr;
  //         }
  //       }
  //       setLabelColorMap(parsedMap);

  //       setProgress(0.7)
  //     } catch (err) {
  //       console.warn("❗ Failed to fetch colormap:", err);
  //     }
  //   };

  //   fetchColorMap();
  // }, [pantsCase]);
  

  // Update VOI (window/level) settings
  const handleWindowChange = (newWidth: number | null, newCenter: number | null) => {
    const _width = Math.max(newWidth ?? windowWidth, 1);
    const _center = newCenter ?? windowCenter;

    setWindowWidth(_width);
    setWindowCenter(_center);

    if (!renderingEngine || !viewportIds.length || !volumeId) return;

    const windowLow = _center - _width / 2;
    const windowHigh = _center + _width / 2;

    viewportIds.forEach((viewportId) => {
      const viewport = renderingEngine.getViewport(viewportId);
      const actors = viewport.getActors();

      for (const actor of actors) {
        if (actor.uid === volumeId) {
          try {
            const tf = actor.actor.getProperty().getRGBTransferFunction(0);
            tf.setMappingRange(windowLow, windowHigh);
            tf.updateRange();
            viewport.render();
          } catch (e) {
            console.warn("[VOI Error]", e);
          }
        }
      }
    });
  };


  // Apply window settings on change
  useEffect(() => {
    if (renderingEngine && viewportIds.length && volumeId) {
      handleWindowChange(windowWidth, windowCenter);
    }
  }, [renderingEngine, viewportIds, volumeId]);


  // Update segmentation visibility when state changes
  useEffect(() => {
    if (segmentationRepresentationUIDs && checkState && NV) {
      const checkStateArr = [
        true,  // ID=0 background 永远可见
        ...checkBoxData.map(item => !!checkState[item.id])
      ];
      console.log('150', checkStateArr);
      setVisibilities(segmentationRepresentationUIDs, checkStateArr);
      updateVisibilities(NV, checkStateArr, sessionKey, cmapRef.current);
    }
  }, [segmentationRepresentationUIDs, checkState, NV, checkBoxData, sessionKey]);
  



  const handleOpacityOnSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    setOpacityValue(value);
    setToolGroupOpacity(value / 100);
    // updateGeneralOpacity(render_ref, value / 100);
  };

  const handleOpacityOnFormSubmit = (value: number) => {
    setOpacityValue(value);
    setToolGroupOpacity(value / 100);
    // updateGeneralOpacity(render_ref, value / 100);
  };

  const handleDownloadClick = async () => {
    const response = await fetch(`${API_BASE}/api/download/${pantsCase}`);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `${pantsCase}_segmentations.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const navBack = () => {
    navigate('/');
  };
  const PREVIEW_IDS = [1, 17, 30, 35, 121];


  if (PREVIEW_IDS.filter(id => id === Number(pantsCase)).length === 0) {
    navigate("/");
    return null;
  }

  return (
    <div className="VisualizationPage" style={{ display: 'flex', overflow: 'hidden', flexDirection: 'column', height: '100vh', width: '100vw' }}>
      <div style={{ position: 'relative' }}>
        <div className="sidebar position-absolute z-3 top-0 left-0">
          
          <div>
            <div className='flex'>
            <div
              className={`hover:bg-gray-700 z-4 cursor-pointer bg-[#0f0824] p-2 ml-4 mt-4 rounded-lg w-fit`}
              onClick={() => setShowTaskDetails(prev => !prev)}
              >
              <IconSettings color="white"/>
              {/* {showTaskDetails ? "Settings" : "Settings"} */}
            </div>
            <div
              className={`hover:bg-gray-700 z-4 cursor-pointer bg-[#0f0824] p-2 ml-4 mt-4 rounded-lg w-fit`}
              onClick={() => navBack()}
              >
              <IconHome color="white"/>
              {/* {showTaskDetails ? "Settings" : "Settings"} */}
            </div>
            </div>
            <div className={`text-black bg-[#0f0824] m-[2vh] z-3 rounded-lg w-fit p-6 pt-3 gap-3 flex flex-col relative transition-all duration-100 origin-top-left ${showTaskDetails ? "scale-0" : "scale-100"}`}>
              {/* Toggle dropdown */}
  
              {!showTaskDetails && (
                <>
                  <div className="flex items-center justify-center mb-2">
                    <div className="text-white font-bold text-xl">{`Case ID: ${pantsCase}`}</div>
                  </div>
  
  
                  {/* Opacity & Windowing Sliders */}
                  <OpacitySlider
                    opacityValue={opacityValue}
                    handleOpacityOnSliderChange={handleOpacityOnSliderChange}
                    handleOpacityOnFormSubmit={handleOpacityOnFormSubmit}
                  />
  
                  <WindowingSlider
                    windowWidth={windowWidth}
                    windowCenter={windowCenter}
                    onWindowChange={handleWindowChange}
                  />
                  <button className='text-white relative pt-3 !bg-blue-700 hover:!border-white' onClick={() => {setShowOrganDetails(prev => !prev); setShowTaskDetails(prev => !prev);}}>
                    Class Map
                  </button>
  
                  {/* Report Download Buttons */}
                  <div className="flex gap-3 items-center justify-center">
                    <div className='group hover:bg-gray-700 cursor-pointer p-2 rounded-md relative  '>
                    <IconDownload onClick={handleDownloadClick} className='w-6 h-6 text-white relative'>
                    </IconDownload>
                      <span className="transition-all pointer-events-none duration-100 scale-0 group-hover:scale-100 absolute top-0 left-12 z-1 bg-gray-900 text-white rounded-md p-2">Download</span>
                    </div>
                    <div className='group hover:bg-gray-700 cursor-pointer p-2 rounded-md relative'>
                    <IconReport className='w-6 h-6 text-white relative' onClick={() => setShowReportScreen(prev => !prev)}>
                    </IconReport>
                    <span className="transition-all pointer-events-none duration-100 scale-0 group-hover:scale-100 absolute top-0 left-12 z-1 bg-gray-900 text-white rounded-md p-2">Report</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
  

        </div>
        
        
        {/* {
          loading ?
          <div className="flex z-3 absolute top-0 left-0 w-screen h-screen items-center justify-center">
              <div role="status">
                  <svg aria-hidden="true" className="w-8 h-8 text-gray-200 animate-spin dark:text-gray-600 fill-blue-600" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor"/><path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill"/></svg>
                  <span className="sr-only">Loading...</span>
              </div>
          </div>
          :
          null
        } */}
        {
          loading ? 
         <RotatingModelLoader/>:
          null
        }
          <div
            className="visualization-container"
            ref={VisualizationContainer_ref}
            style={{ overflow: 'hidden' }}
          > 


            <div
              className="axial"
              ref={axial_ref}
              onMouseDown={(e) =>
                setLastClicked({
                  orientation: 'axial',
                  x: Math.floor(e.clientX - e.currentTarget.getBoundingClientRect().left),
                  y: Math.floor(e.clientY - e.currentTarget.getBoundingClientRect().top),
                })
              }
            ></div>
    
            <div
              className="sagittal"
              ref={sagittal_ref}
              onMouseDown={(e) =>
                setLastClicked({
                  orientation: 'sagittal',
                  x: Math.floor(e.clientX - e.currentTarget.getBoundingClientRect().left),
                  y: Math.floor(e.clientY - e.currentTarget.getBoundingClientRect().top),
                })
              }
            ></div>
    
            <div
              className="coronal"
              ref={coronal_ref}
              onMouseDown={(e) =>
                setLastClicked({
                  orientation: 'coronal',
                  x: Math.floor(e.clientX - e.currentTarget.getBoundingClientRect().left),
                  y: Math.floor(e.clientY - e.currentTarget.getBoundingClientRect().top),
                })
              }
            ></div>
    
            <div className="render">
              <div className="canvas">
                <canvas ref={render_ref}></canvas>
              </div>
            </div>
          </div>



      </div>
  
      {/* Fixed bottom bar for organ selection */}

        <OrganCheckbox
          setCheckState={setCheckState}
          checkState={checkState}
          sessionId={sessionKey}
          setShowTaskDetails={setShowTaskDetails}
          setShowOrganDetails={setShowOrganDetails}
          showOrganDetails={showOrganDetails}
          labelColorMap={labelColorMap}
        />

  
      {showReportScreen && (
        <ReportScreen id={pantsCase} onClose={() => setShowReportScreen(false)} />
      )}
    </div>
  );
  
}

export default VisualizationPage;

