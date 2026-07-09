import { IconCrosshair, IconTrash } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import {
	clearMeasurements,
	getMeasurementSummaries,
	jumpToMeasurement,
	removeMeasurement,
	renameMeasurement,
	subscribeToMeasurementChanges,
	type MeasurementSummary,
} from "../../helpers/CornerstoneNifti2";
import { toolDisplayName } from "../../helpers/sessionReport";
import "./MeasurementPanel.css";

type Props = {
	onClose: () => void;
	/** Called with the world-mm target after a jump, so the page can sync its own crosshair state. */
	onJump?: (mm: [number, number, number]) => void;
};

// Right-side inventory of every measurement on the images: rename it (e.g.
// "lesion"), jump the crosshair to it, or delete it. Named labels flow into the
// reading-session report.
function MeasurementPanel({ onClose, onJump }: Props) {
	const [items, setItems] = useState<MeasurementSummary[]>(() => getMeasurementSummaries());

	useEffect(() => {
		// Any change (draw / drag-edit / delete) refreshes the whole list — it's tiny.
		const unsubscribe = subscribeToMeasurementChanges(() => {
			setItems(getMeasurementSummaries());
		});
		return unsubscribe;
	}, []);

	const commitLabel = (uid: string, label: string) => {
		renameMeasurement(uid, label.trim());
		setItems(getMeasurementSummaries());
	};

	return (
		<div className="vp-measure" role="region" aria-label="Measurements">
			<div className="vp-measure__head">
				<span className="vp-panel__title">Measurements</span>
				<div className="vp-measure__actions">
					{items.length > 0 && (
						<button
							className="vp-measure__clear"
							onClick={() => {
								clearMeasurements();
								setItems([]);
							}}
						>
							Clear all
						</button>
					)}
					<button className="vp-measure__close" onClick={onClose} aria-label="Close measurements">
						×
					</button>
				</div>
			</div>
			{items.length === 0 ? (
				<div className="vp-measure__empty">
					No measurements yet.
					<br />
					<span>Pick a tool from the Measure menu (or press L / A / P / R / E) and draw on a slice.</span>
				</div>
			) : (
				<div className="vp-measure__list">
					{items.map((m) => (
						<div className="vp-measure__item" key={m.uid}>
							<div className="vp-measure__main">
								<input
									className="vp-measure__label"
									defaultValue={m.label}
									placeholder={toolDisplayName(m.tool)}
									aria-label="Measurement label"
									onBlur={(e) => {
										if (e.target.value.trim() !== m.label) commitLabel(m.uid, e.target.value);
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter") (e.target as HTMLInputElement).blur();
									}}
								/>
								<span className="vp-measure__value">{m.value}</span>
							</div>
							<div className="vp-measure__meta">{toolDisplayName(m.tool)}</div>
							<div className="vp-measure__btns">
								<button
									className="vp-measure__btn"
									title="Jump to this measurement"
									aria-label="Jump to this measurement"
									disabled={!m.center}
									onClick={() => {
										const mm = jumpToMeasurement(m.uid);
										if (mm) onJump?.(mm);
									}}
								>
									<IconCrosshair size={15} />
								</button>
								<button
									className="vp-measure__btn vp-measure__btn--danger"
									title="Delete this measurement"
									aria-label="Delete this measurement"
									onClick={() => removeMeasurement(m.uid)}
								>
									<IconTrash size={15} />
								</button>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

export default MeasurementPanel;
