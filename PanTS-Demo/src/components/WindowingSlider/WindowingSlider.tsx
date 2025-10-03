import React from "react";

import { useState } from "react";

type Props = {
  windowWidth: number;
  windowCenter: number;
  onWindowChange: (width: number | null, center: number | null) => void;
}
export default function WindowingSlider({ windowWidth, windowCenter, onWindowChange }: Props) {
  const [widthInput, setWidthInput] = useState(windowWidth);
  const [centerInput, setCenterInput] = useState(windowCenter);

  const handleWidthInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const num = Number(e.target.value);
    setWidthInput(num);
  };

  const handleCenterInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCenterInput(Number(e.target.value));
  };

  const handleWidthSubmit = (e: React.ChangeEvent<HTMLFormElement>) => {
    e.preventDefault();
    let v = widthInput;
    if (!isNaN(v)) {
      v = Math.min(Math.max(v, 1), 5000);
      onWindowChange(v, null);
    }
  };

  const handleCenterSubmit = (e: React.ChangeEvent<HTMLFormElement>) => {
    e.preventDefault();
    let v = centerInput;
    if (!isNaN(v)) {
      v = Math.min(Math.max(v, -1000), 1000);
      onWindowChange(null, v);
    }
  };
  return (
    <div className="windowing-slider w-full flex flex-col gap-3">

      <div className="flex gap-1 flex-col w-full justify-center items-center">
        <div className="flex justify-between w-full items-center">

        <label style={{ color: 'white' }}>Level</label>

        <form onSubmit={handleCenterSubmit}  className="w-1/3">
          <input
            type="number"
            value={centerInput}
            onChange={handleCenterInputChange}
            min="-1000"
            max="1000"
            className="text-white rounded-md p-1 border w-full"
            />
        </form>
          </div>
        <input
          type="range"
          min="-1000"
          max="1000"
          step="1"
          value={windowCenter}
          onChange={(e) => {
            const v = parseInt(e.target.value);
            setCenterInput(v);
            onWindowChange(null, v);
          }}
          className="w-full"
        />
      </div>
      <div className="flex gap-2 flex-col w-full justify-center items-center">
        <div className="flex justify-between w-full items-center">

        <label style={{ color: 'white' }}>Window</label>

        <form onSubmit={handleWidthSubmit} className="w-1/3">
          <input
            type="number"
            value={widthInput}
            min="1"
            max="5000"
            onChange={handleWidthInputChange}
          className="border text-white p-1 rounded-md w-full"
            />
        </form>
        </div>
        <input
          type="range"
          min="1"
          max="5000"
          step="1"
          value={windowWidth}
          onChange={(e) => {
            const v = parseInt(e.target.value);
            setWidthInput(v);
            onWindowChange(v, null);
          }}
          className="w-full"
        />
      </div>
    </div>
  );
}
