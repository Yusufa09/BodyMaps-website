import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE } from "../helpers/constants";
import { prefetchViewer } from "../helpers/prefetchViewer";
import type { PreviewType } from "../types";

type Props = {
	id: number;
	previewMetadata: PreviewType;
};

export default function Preview({ id, previewMetadata }: Props) {
	const navigate = useNavigate();
	const [imgLoaded, setImgLoaded] = useState(false);
	const [imgError, setImgError] = useState(false);
	const [hovered, setHovered] = useState(false);
	// Prefer the lab's local data via the existing backend endpoint; fall back to
	// the HuggingFace dataset if the local profile image isn't available on the
	// server (so thumbnails never break regardless of deployment). Loaded natively
	// (no blob round-trip) so the browser streams cards in parallel and caches them.
	const [thumbUrl, setThumbUrl] = useState(
		`${API_BASE}/api/get_image_preview/${id}`
	);

	if (!previewMetadata) return null;

	const caseIdStr = `PanTS_${id.toString().padStart(8, "0")}`;
	const hfThumbUrl = `https://huggingface.co/datasets/BodyMaps/iPanTSMini/resolve/main/profile_only/${caseIdStr}/profile.jpg`;

	const handleImgError = () => {
		if (thumbUrl !== hfThumbUrl) {
			setThumbUrl(hfThumbUrl); // local failed — retry via HuggingFace
		} else {
			setImgError(true); // both sources failed
		}
	};

	return (
		<div
			className="bm-card rounded-xl overflow-hidden cursor-pointer group"
			style={
				hovered
					? {
							borderColor: "rgba(0,0,0,0.18)",
							boxShadow:
								"0 0 0 1px rgba(0,0,0,0.05), 0 8px 32px rgba(0,0,0,0.10), 0 2px 12px rgba(0,0,0,0.10)",
							transform: "translateY(-2px)",
					  }
					: {}
			}
			onMouseEnter={() => {
				setHovered(true);
				prefetchViewer(); // warm the viewer JS chunk so clicking feels instant
			}}
			onMouseLeave={() => setHovered(false)}
			onClick={() => navigate(`/case/${id}`)}
		>
			{/* Gradient accent line — slides in on hover */}
			<div
				style={{
					height: "1px",
					background:
						"linear-gradient(90deg, transparent, rgba(0,0,0,0.45), transparent)",
					opacity: hovered ? 1 : 0,
					transition: "opacity 0.3s",
				}}
			/>

			{/* Thumbnail */}
			<div
				className="relative overflow-hidden"
				style={{ aspectRatio: "4/3", background: "#000" }}
			>
				{!imgError && (
					<img
						src={thumbUrl}
						alt={`Case ${id} CT scan`}
						loading="lazy"
						decoding="async"
						onLoad={() => setImgLoaded(true)}
						onError={handleImgError}
						className="w-full h-full object-cover"
						style={{
							opacity: imgLoaded ? (hovered ? 1 : 0.97) : 0,
							transform: hovered ? "scale(1.05)" : "scale(1)",
							transition: "opacity 0.4s, transform 0.5s",
						}}
					/>
				)}
				{!imgLoaded && !imgError && (
					<div className="absolute inset-0 flex items-center justify-center">
						<div
							className="w-7 h-7 rounded-full animate-spin"
							style={{
								border: "2px solid rgba(255,255,255,0.15)",
								borderTopColor: "rgba(255,255,255,0.6)",
							}}
						/>
					</div>
				)}

				{/* Bottom fade to card bg */}
				<div
					className="absolute inset-0"
					style={{
						background:
							"linear-gradient(to top, #f5f5f5 0%, rgba(245,245,245,0.5) 45%, transparent 80%)",
					}}
				/>

				{/* Corner brackets — appear on hover */}
				{(["tl", "tr", "bl", "br"] as const).map((corner) => (
					<div
						key={corner}
						className="absolute w-4 h-4"
						style={{
							top: corner[0] === "t" ? "8px" : "auto",
							bottom: corner[0] === "b" ? "8px" : "auto",
							left: corner[1] === "l" ? "8px" : "auto",
							right: corner[1] === "r" ? "8px" : "auto",
							borderTop: corner[0] === "t" ? "1.5px solid rgba(255,255,255,0.55)" : "none",
							borderBottom: corner[0] === "b" ? "1.5px solid rgba(255,255,255,0.55)" : "none",
							borderLeft: corner[1] === "l" ? "1.5px solid rgba(255,255,255,0.55)" : "none",
							borderRight: corner[1] === "r" ? "1.5px solid rgba(255,255,255,0.55)" : "none",
							opacity: hovered ? 1 : 0,
							transition: "opacity 0.25s",
						}}
					/>
				))}
			</div>

			{/* Data row */}
			<div className="p-3">
				<div className="mb-1">
					<span
						className="font-bold"
						style={{ fontSize: "13px", color: "#111111" }}
					>
						{caseIdStr}
					</span>
				</div>

				<div
					className="flex items-center gap-2"
					style={{ fontSize: "11px", fontWeight: 700, color: "#111111" }}
				>
					<span>Sex {previewMetadata.sex || "—"}</span>
					<span>Age {previewMetadata.age || "—"}y</span>
					<span
						style={{
							color: previewMetadata.tumor ? "#ef4444" : "#10b981",
							fontWeight: 600,
						}}
					>
						{previewMetadata.tumor ? "Tumor" : "No Tumor"}
					</span>
				</div>
			</div>
		</div>
	);
}
