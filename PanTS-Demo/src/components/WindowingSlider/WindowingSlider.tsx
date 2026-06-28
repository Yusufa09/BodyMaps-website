
import { useEffect, useState } from "react";

type Props = {
  windowWidth: number;
  windowCenter: number;
  onWindowChange: (width: number | null, center: number | null) => void;
}
export default function WindowingSlider({ windowWidth, windowCenter, onWindowChange }: Props) {
  // Brightness is shown as the negated center (matching the slider below), so the
  // number boxes and sliders display the same value.
  const [widthInput, setWidthInput] = useState(windowWidth);
  const [centerInput, setCenterInput] = useState(windowCenter * -1);

  // Keep the number inputs in sync when the parent changes the window (e.g. clicking
  // a CT preset). Without this the sliders move but the number boxes stay stale.
  useEffect(() => {
    setWidthInput(windowWidth);
  }, [windowWidth]);
  useEffect(() => {
    setCenterInput(windowCenter * -1);
  }, [windowCenter]);

  const handleWidthInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const num = Number(e.target.value);
    setWidthInput(num);
  };

  const handleCenterInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCenterInput(Number(e.target.value));
  };

  // Apply the typed values. Called on Enter (form submit) and on blur (clicking off
  // the field), so edits take effect without forcing the user to press Enter.
  const applyWidth = () => {
    let v = widthInput;
    if (!isNaN(v)) {
      v = Math.min(Math.max(v, 1), 2000);
      onWindowChange(v, null);
    }
  };

  const applyCenter = () => {
    let v = centerInput * -1;
    if (!isNaN(v)) {
      v = Math.min(Math.max(v, -1000), 1000);
      onWindowChange(null, v);
    }
  };

  const handleWidthSubmit = (e: React.ChangeEvent<HTMLFormElement>) => {
    e.preventDefault();
    applyWidth();
  };

  const handleCenterSubmit = (e: React.ChangeEvent<HTMLFormElement>) => {
    e.preventDefault();
    applyCenter();
  };
  return (
    <div className="vp-panel">
      <div className="vp-panel__title">Brightness / Contrast</div>
      <div className="flex flex-col gap-2">
        <div className="vp-row">
          <label className="vp-label">Brightness</label>
          <form onSubmit={handleCenterSubmit}>
            <input
              type="number"
              aria-label="Brightness"
              value={centerInput}
              onChange={handleCenterInputChange}
              onBlur={applyCenter}
              min="-1000"
              max="1000"
              className="vp-input"
            />
          </form>
        </div>
        <input
          type="range"
          min="-1000"
          max="1000"
          aria-label="Brightness"
          step="1"
          value={windowCenter * -1}
          onChange={(e) => {
            const v = parseInt(e.target.value);
            setCenterInput(v);
            onWindowChange(null, v * -1);
          }}
          className="vp-range"
        />
      </div>
      <div className="flex flex-col gap-2">
        <div className="vp-row">
          <label className="vp-label">Contrast</label>
          <form onSubmit={handleWidthSubmit}>
            <input
              type="number"
              value={widthInput}
              min="1"
              aria-label="Contrast"
              max="200"
              onChange={handleWidthInputChange}
              onBlur={applyWidth}
              className="vp-input"
            />
          </form>
        </div>
        <input
          type="range"
          min="1"
          max="2000"
          aria-label="Contrast"
          step="1"
          value={windowWidth}
          onChange={(e) => {
            const v = parseInt(e.target.value);
            setWidthInput(v);
            onWindowChange(v, null);
          }}
          className="vp-range"
        />
      </div>
    </div>
  );
}
