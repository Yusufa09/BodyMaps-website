import type { Color } from '@cornerstonejs/core/dist/types/types';
import { IconArrowLeft, IconChevronRight } from '@tabler/icons-react';
import React, { useEffect, useState } from 'react';
import { OrganSystems, OrganSystemsArray, segmentation_categories } from '../helpers/constants';
import { type AllSystems, type OrganSystemsAllType, type SubSystems, type Systems } from '../types';

type ChipBoxProps = {
  labelColorMap: {[key: number]: number[]};
  system: AllSystems;
  setCheckState: React.Dispatch<React.SetStateAction<boolean[]>>;
  checkState: boolean[];
  level: number;
  OrganSystem: OrganSystemsAllType
}

type Props = {
  labelColorMap: {[key: number]: Color};
  setCheckState: React.Dispatch<React.SetStateAction<boolean[]>>;
  checkState: boolean[];
  sessionId: string | undefined;
  setShowTaskDetails: React.Dispatch<React.SetStateAction<boolean>>;
  setShowOrganDetails: React.Dispatch<React.SetStateAction<boolean>>;
  showOrganDetails: boolean;
}

const getOrganIdx = (organ: string) => {
  for (let i = 0; i < segmentation_categories.length; i++) {
    if (segmentation_categories[i] === organ) {
      return i;
    }
  }
  return 0;
}

function Checked({ OrganSystem, system, labelColorMap, checkState, setCheckState, level=0 }: ChipBoxProps) {
    const [collapsed, setCollapsed] = useState(false);
    const [toggled, setToggled] = useState(true);

    useEffect(() => {
      if (!OrganSystem[system]) return;
      OrganSystem[system].forEach((sub) => {
        setCheckState(checkState => {
          const newCheckState = [...checkState];
          if (typeof sub === "string") {
            newCheckState[getOrganIdx(sub)+1] = toggled; 
            return newCheckState
          }
          const key: SubSystems = Object.keys(sub)[0] as SubSystems;
          const suborgans = sub[key];
          if (!suborgans) return newCheckState;
          suborgans.forEach((suborgan) => newCheckState[getOrganIdx(suborgan)+1] = toggled);
          return newCheckState;
        });
      })
      
    }, [toggled, setCheckState, OrganSystem, system])
    if (!OrganSystem[system] || level > 1) return null;
    return (
      <div className={`flex gap-2 flex-col ${level === 0 ? "" : "pl-4"}`} >
        <div className="flex justify-between items-center">
            <div className={`flex items-center ${level === 0 ? "gap-2" : "gap-1"} cursor-pointer`} onClick={() => setCollapsed(prev => !prev)}>
            <IconChevronRight className={`cursor-pointer text-white hover:bg-gray-700 rounded-md flex items-center justify-center transition-all duration origin-center ${collapsed ? "rotate-90" : ""}`} />
            <div className={`text-white ${level === 0 ? "text-lg" : "text-md"}`}>{system}</div>
            </div>
            <input type="checkbox" className="w-4 h-4 text-blue-600 !bg-gray-700 border-gray-600 !rounded-sm focus:ring-blue-600 ring-offset-gray-800 focus:ring-2"
              checked={toggled}
              onChange={(e) => setToggled(e.target.checked)}
            />
        </div>
            <div className={`flex flex-col gap-2 transition-all duration-100 origin-top ${!collapsed ? "hidden scale-y-0" : "scale-y-100"}`}>
            {OrganSystem[system].map((organ, idx) => {
              if (typeof organ === "string") {
                
                const color = labelColorMap[getOrganIdx(organ)+1];
                const rgb = color ? `rgb(${color[0]}, ${color[1]}, ${color[2]})` : "gray";
                return (
                  <div className={`flex items-center gap-2 "pl-4"`} key={idx}>
                <div className="cursor-pointer text-white hover:bg-gray-700 rounded-md flex items-center justify-center transition-all duration origin-center" />
                <div className={`text-white text-md rounded-md p-1 cursor-pointer hover:border-3 ${!checkState[getOrganIdx(organ)+1] ? "border-0" : "border-2"}`} style={{ borderColor: rgb}} onClick={() => {
                  setCheckState((prev) => {
                    const newCheckState = [...prev];
                    newCheckState[getOrganIdx(organ)+1] = !newCheckState[getOrganIdx(organ)+1];
                    return newCheckState;
                  });
                }}>{organ}</div>
                </div>
                )
            } else if(typeof organ === "object" && Object.keys(organ).length === 1) {
              const organKey: AllSystems = Object.keys(organ)[0] as AllSystems;
              return <>
                <Checked key={Object.keys(organ)[0]} OrganSystem={organ} system={organKey} labelColorMap={labelColorMap} checkState={checkState} setCheckState={setCheckState} level={level+1} />
              </>
            }
            })}
            </div>
        </div>
    );
}


function OrganCheckbox({ setCheckState, checkState, labelColorMap, setShowTaskDetails, setShowOrganDetails, showOrganDetails }: Props) {
  

  const toggleAll = () => {
    setCheckState(prev => {
      let newState = [...prev];
      const trueCount = newState.filter(val => val === true).length;
      if (trueCount > newState.length / 2) {
        newState = newState.map(() => false)
      } else {
        newState = newState.map(() => true)
      }
      return newState;
    });
  };


  return (
    <div className={`flex w-2xs h-screen flex-col gap-4 p-3 z-5 absolute top-0 left-0 bg-[#0f0824] duration-100 transition-all ${showOrganDetails ? 'translate-x-0' : '-translate-x-full'} origin-left`}>
        <div className="flex gap-4 items-center justify-start">
            <IconArrowLeft className="cursor-pointer text-white hover:bg-gray-700 rounded-md flex items-center justify-center" onClick={() => {setShowTaskDetails(false); setShowOrganDetails(false)}} />
            <div className="text-white text-2xl">Organs</div>
        </div>
        <button className='w-full mt-3' onClick={() => toggleAll()}>Toggle all</button>
        <div className='flex flex-col gap-2 overflow-scroll'>

        {OrganSystemsArray.map((system: Systems, idx) => {
            return (
               <Checked
                  level={0}
                  OrganSystem={OrganSystems}
                  key={idx}
                  system={system}
                  labelColorMap={labelColorMap}
                  checkState={checkState}
                  setCheckState={setCheckState}
               />
            )
        })}
        </div>
        <div className='w-full'>
        </div>
    </div>
  );
  
  
} 
export default OrganCheckbox;
