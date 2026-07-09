import { IconArrowBackUp, IconArrowForwardUp, IconBrush, IconCloudUpload, IconDownload, IconEraser } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { API_BASE } from "../../helpers/constants";
import {
	getMaskEditHistoryState,
	getSegmentationExport,
	redoMaskEdit,
	setActiveEditSegment,
	setMaskBrushSize,
	subscribeToSegmentationEdits,
	undoMaskEdit,
} from "../../helpers/CornerstoneNifti2";
import { buildNiftiGzBlob } from "../../helpers/niftiWriter";
import { downloadBlob } from "../../helpers/readingSession";
import type { CheckBoxData } from "../../types";
import "./MaskEditPanel.css";

export type MaskEditMode = "brush" | "eraser" | null;

type Props = {
	organs: CheckBoxData[];
	caseId: string;
	/** Dataset case id — enables "Save to server" (versioned under edited_masks/). */
	serverCaseId?: string;
	mode: MaskEditMode;
	onModeChange: (mode: MaskEditMode) => void;
	onClose: () => void;
	/** Reading-session hook — fires once per edit burst with a description. */
	onEdit?: (detail: string) => void;
};

const DEFAULT_BRUSH_MM = 10;

// Right-side panel for correcting the segmentation masks: pick the target organ,
// paint or erase on any 2D pane, undo/redo, and download the edited labelmap as
// .nii.gz. Everything happens client-side on the loaded labelmap volume.
function MaskEditPanel({ organs, caseId, serverCaseId, mode, onModeChange, onClose, onEdit }: Props) {
	const [segment, setSegment] = useState(organs[0]?.id ?? 1);
	const [brushMm, setBrushMm] = useState(DEFAULT_BRUSH_MM);
	const [edited, setEdited] = useState(false);
	const [history, setHistory] = useState({ canUndo: false, canRedo: false });
	const [exporting, setExporting] = useState(false);
	const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

	// Seed the brush target/size when the panel opens.
	useEffect(() => {
		setActiveEditSegment(segment);
		setMaskBrushSize(brushMm);
		// mount-only seeding; the change handlers below keep them current
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		const organLabel = organs.find((o) => o.id === segment)?.label ?? `segment ${segment}`;
		const unsubscribe = subscribeToSegmentationEdits(() => {
			setEdited(true);
			setHistory(getMaskEditHistoryState());
			onEdit?.(`Edited ${organLabel} mask`);
		});
		return unsubscribe;
	}, [segment, organs, onEdit]);

	// Versioned save into {PANTS_PATH}/edited_masks/<case>/ — never overwrites the
	// dataset's original labels.
	const saveToServer = async () => {
		if (!serverCaseId) return;
		const labelmap = getSegmentationExport();
		if (!labelmap) return;
		setSaveState("saving");
		try {
			const form = new FormData();
			form.append("mask", buildNiftiGzBlob(labelmap), "combined_labels_edited.nii.gz");
			const res = await fetch(`${API_BASE}/api/save-edited-mask/${serverCaseId}`, {
				method: "POST",
				body: form,
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
			setSaveState("saved");
			window.setTimeout(() => setSaveState("idle"), 2500);
		} catch (e) {
			console.error(e);
			setSaveState("error");
			window.setTimeout(() => setSaveState("idle"), 4000);
		}
	};

	const download = () => {
		const labelmap = getSegmentationExport();
		if (!labelmap) return;
		setExporting(true);
		try {
			// Gzipping a full labelmap blocks for a moment; a rAF lets the button
			// repaint to its busy state first.
			requestAnimationFrame(() => {
				try {
					downloadBlob(buildNiftiGzBlob(labelmap), `case${caseId}_edited_labels.nii.gz`);
				} finally {
					setExporting(false);
				}
			});
		} catch {
			setExporting(false);
		}
	};

	return (
		<div className="vp-edit" role="region" aria-label="Edit masks">
			<div className="vp-edit__head">
				<span className="vp-panel__title">Edit Masks</span>
				<button className="vp-edit__close" onClick={onClose} aria-label="Close mask editing">
					×
				</button>
			</div>
			<div className="vp-edit__body">
				<label className="vp-edit__field">
					<span className="vp-edit__label">Target organ</span>
					<select
						className="vp-edit__select"
						value={segment}
						onChange={(e) => {
							const id = Number(e.target.value);
							setSegment(id);
							setActiveEditSegment(id);
						}}
					>
						{organs.map((o) => (
							<option key={o.id} value={o.id}>
								{o.label}
							</option>
						))}
					</select>
				</label>

				<div className="vp-edit__modes">
					<button
						className={`vp-edit__mode ${mode === "brush" ? "is-active" : ""}`}
						onClick={() => onModeChange(mode === "brush" ? null : "brush")}
					>
						<IconBrush size={16} /> Paint
					</button>
					<button
						className={`vp-edit__mode ${mode === "eraser" ? "is-active" : ""}`}
						onClick={() => onModeChange(mode === "eraser" ? null : "eraser")}
					>
						<IconEraser size={16} /> Erase
					</button>
				</div>

				<label className="vp-edit__field">
					<span className="vp-edit__label">
						Brush size <span className="vp-edit__val">{brushMm} mm</span>
					</span>
					<input
						type="range"
						min="2"
						max="40"
						step="1"
						className="vp-range"
						aria-label="Brush size"
						value={brushMm}
						onChange={(e) => {
							const mm = Number(e.target.value);
							setBrushMm(mm);
							setMaskBrushSize(mm);
						}}
					/>
				</label>

				<div className="vp-edit__history">
					<button
						className="vp-edit__btn"
						disabled={!history.canUndo}
						onClick={() => {
							undoMaskEdit();
							setHistory(getMaskEditHistoryState());
						}}
					>
						<IconArrowBackUp size={15} /> Undo
					</button>
					<button
						className="vp-edit__btn"
						disabled={!history.canRedo}
						onClick={() => {
							redoMaskEdit();
							setHistory(getMaskEditHistoryState());
						}}
					>
						<IconArrowForwardUp size={15} /> Redo
					</button>
				</div>

				<button className="vp-edit__download" disabled={!edited || exporting} onClick={download}>
					<IconDownload size={16} />
					{exporting ? "Packing…" : "Download edited mask (.nii.gz)"}
				</button>
				{serverCaseId && (
					<button
						className={`vp-edit__save ${saveState === "error" ? "is-error" : ""}`}
						disabled={!edited || saveState === "saving"}
						onClick={() => { void saveToServer(); }}
					>
						<IconCloudUpload size={16} />
						{saveState === "saving"
							? "Saving…"
							: saveState === "saved"
								? "Saved ✓"
								: saveState === "error"
									? "Save failed — retry"
									: "Save to server (new version)"}
					</button>
				)}
				<div className="vp-edit__hint">
					{mode
						? `${mode === "brush" ? "Painting" : "Erasing"} on the 2D panes — drag to ${mode === "brush" ? "fill" : "clear"}.`
						: "Pick Paint or Erase, then drag on any 2D pane."}
					{" "}Edits stay in your browser until downloaded.
				</div>
			</div>
		</div>
	);
}

export default MaskEditPanel;
