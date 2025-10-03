import { useEffect, useState } from "react";
import { setZoom } from "../helpers/CornerstoneNifti";
type Props = {
	submitted: number;
	setSubmitted: React.Dispatch<React.SetStateAction<number>>;
};
const ZoomHandle = ({ submitted, setSubmitted }: Props) => {
	const [text, setText] = useState(submitted.toString());
	// const [submitted, setSubmitted] = useState(1);
	useEffect(() => {
		setZoom(submitted);
		setText(submitted.toFixed(2));
	}, [submitted]);

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			const num = Math.min(Math.max(Number(text), 0.5), 2);

			if (!isNaN(num)) {
				setSubmitted(num);
				setText(num.toFixed(2)); // clear input if you want
			} else {
				setText(submitted.toFixed(2));
			}
		}
	};
	return (
		<div className="flex gap-2 items-end flex-col">
			<div className="flex gap-2 items-center justify-between">
				<div className="text-white">Zoom Level</div>
				<input
					type="text"
					value={text}
					onChange={(e) => setText(e.target.value.replace(/[^0-9.-]/g, ""))} // allow only digits, minus, dot
					onKeyDown={handleKeyDown}
					className="border text-white p-1 rounded-md w-1/3"
				/>
			</div>
			{/* <div className="flex gap-2 text-white">
				{[0.75, 1, 1.5].map((el, idx) => (
					<button key={idx} onClick={() => setSubmitted(el)} className="!bg-blue-950 h-10 !text-sm">
						{el}x
					</button>
				))}
			</div> */}
            <div  className="flex gap-2 text-white justify-between">
                <button className="text-white !bg-blue-950 w-8 h-8 !p-1" onClick={() => setSubmitted(Math.max(submitted - 0.1, 0.5))}>
                    -
                </button>
                <button className="text-white !bg-blue-950 w-8 h-8 !p-1" onClick={() => setSubmitted(Math.min(submitted + 0.1, 2))}>
                    +
                </button>
            </div>
		</div>
	);
};

export default ZoomHandle;
