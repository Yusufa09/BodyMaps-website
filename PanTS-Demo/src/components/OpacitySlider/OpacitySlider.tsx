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
    <div className="vp-panel">
      <div className="vp-panel__title">Label Settings</div>
      <div className="flex flex-col gap-2">
        <div className="vp-row">
          <span className="vp-label">Label Opacity</span>
          <span className="vp-readout">{Math.round(opacityValue)}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          aria-label="Label opacity"
          className="vp-range"
          value={opacityValue}
          onChange={handleOpacityOnSliderChange}
        />
      </div>
      <button
        className="vp-btn"
        onClick={() => {
          setShowOrganDetails((prev) => !prev);
          setShowTaskDetails((prev) => !prev);
        }}
      >
        Class Map
      </button>
    </div>
  );
}
