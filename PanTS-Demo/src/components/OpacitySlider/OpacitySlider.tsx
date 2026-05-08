import React, { useEffect, useState } from "react";
import './OpacitySlider.css';


type Props = {
  opacityValue: number;
  handleOpacityOnSliderChange: (value: React.ChangeEvent<HTMLInputElement>) => void;
  handleOpacityOnFormSubmit: (value: number) => void;
  setShowOrganDetails: React.Dispatch<React.SetStateAction<boolean>>;
  setShowTaskDetails: React.Dispatch<React.SetStateAction<boolean>>;
}
export default function OpacitySlider({
  opacityValue,
  handleOpacityOnSliderChange,
  setShowOrganDetails,
  setShowTaskDetails
}: Props) {
  const [_textValue, setTextValue] = useState(opacityValue);

  // Sync input field when external opacityValue changes
  useEffect(() => {
    setTextValue(opacityValue);
  }, [opacityValue]);

  // const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  //   setTextValue(Number(e.target.value));
  // };

  // const handleOpacitySubmit = (e: React.ChangeEvent<HTMLFormElement>) => {
  //   e.preventDefault();
  //   let v = Number(textValue);
  //   if (isNaN(v)) return;

  //   // Clamp value between 0 and 100
  //   v = Math.max(0, Math.min(100, v));
  //   setTextValue(v);
  //   handleOpacityOnFormSubmit(v);
  // };



  return (
    <div className="windowing-slider w-full flex flex-col gap-2 border-2 rounded-sm bg-gray-900 shadow-md">
      <div className="bg-gray-600 w-full h-8 flex items-center justify-center text-center rounded-t-sm text-white">Label Settings</div>
      <div className="pb-2 pl-4 pr-4 flex flex-col gap-2">

        <div className="flex gap-1 flex-col justify-center items-center">
          <div className="flex justify-between w-full items-center">
            <div className="text-white">Label Opacity</div>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            aria-label="s"
            className="w-full"
            value={opacityValue}
            onChange={handleOpacityOnSliderChange}
          />
        </div>
        <button
          className="text-white relative !p-1 text-2xs !bg-gray-700 hover:!border-white"
          onClick={() => {
            setShowOrganDetails((prev) => !prev);
            setShowTaskDetails((prev) => !prev);
          }}
        >
          Class Map
        </button>
      </div>
    </div>
  );
}
