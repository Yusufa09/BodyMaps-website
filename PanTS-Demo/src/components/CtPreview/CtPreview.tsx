import { Niivue, NVImage, SLICE_TYPE } from "@niivue/niivue";
import { useEffect, useRef, useState } from "react";

// Lightweight, client-side preview of a locally-selected CT (.nii/.nii.gz) — loaded
// straight into NiiVue from the File object, no upload/server round-trip. Lets users
// verify the right file + slice orientation before running inference. Lazy-loaded by
// the upload page so NiiVue isn't pulled into that bundle until a file is chosen.
export default function CtPreview({ file }: { file: File }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [error, setError] = useState(false);
	const [ready, setReady] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setError(false);
		setReady(false);
		const nv = new Niivue({
			sliceType: SLICE_TYPE.MULTIPLANAR,
			backColor: [0.03, 0.035, 0.04, 1],
			show3Dcrosshair: true,
		});
		const load = async () => {
			if (!canvasRef.current) return;
			try {
				nv.attachToCanvas(canvasRef.current);
				const nvImage = await NVImage.loadFromFile({ file });
				if (cancelled) return;
				nv.addVolume(nvImage);
				nv.setSliceType(SLICE_TYPE.MULTIPLANAR);
				setReady(true);
			} catch (e) {
				console.error("CT preview failed to load", e);
				if (!cancelled) setError(true);
			}
		};
		load();
		return () => {
			cancelled = true;
		};
	}, [file]);

	if (error) {
		return (
			<div className="ct-preview ct-preview--msg">
				Couldn't preview this file — it will still upload for inference.
			</div>
		);
	}

	return (
		<div className="ct-preview">
			<canvas ref={canvasRef} className="ct-preview-canvas" />
			{!ready && <div className="ct-preview-loading">Loading preview…</div>}
		</div>
	);
}
