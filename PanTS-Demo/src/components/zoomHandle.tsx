import { useEffect, useState } from "react";
import { centerOnCursor, setZoom, zoomToFit } from "../helpers/CornerstoneNifti2";
type Props = {
	submitted: number;
	setSubmitted: React.Dispatch<React.SetStateAction<number>>;
	setZoomMode: React.Dispatch<React.SetStateAction<boolean>>;
};
const ZoomHandle = ({ submitted, setSubmitted, setZoomMode: _setZoomMode }: Props) => {
	const [_text, setText] = useState(submitted.toString());
	// const [submitted, setSubmitted] = useState(1);
	useEffect(() => {
		setZoom(submitted);
		setText(submitted.toFixed(2));
	}, [submitted]);

	// const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
	// 	if (e.key === "Enter") {
	// 		const num = Math.min(Math.max(Number(text), 0.5), 2);

	// 		if (!isNaN(num)) {
	// 			setSubmitted(num);
	// 			setText(num.toFixed(2)); // clear input if you want
	// 		} else {
	// 			setText(submitted.toFixed(2));
	// 		}
	// 	}
	// };
	return (
		<div className="vp-panel">
		<div className="vp-panel__title">Zoom</div>
		<div className="flex flex-col gap-2">
			<div className="vp-row">
				<span className="vp-label">Zoom</span>
				<span className="vp-readout">{submitted.toFixed(2)}×</span>
			</div>
			<input
			type="range"
			min="0.5"
			max="2"
			step="0.11"
			aria-label="Zoom"
			className="vp-range"
			value={submitted}
			onChange={(e) => setSubmitted(Number(e.target.value))}
			/>
		</div>
		<div className="grid grid-cols-2 gap-2 w-full">
			<button className="vp-btn" onClick={() => {
				centerOnCursor();
			}}>
				Center Cursor
			</button>
			<button className="vp-btn" onClick={() => {
				zoomToFit();
				setText("1.0");
			}}>
				Reset
			</button>
		</div>
		</div>
	);
};

export default ZoomHandle;
