// Live side-by-side CT comparison: two 3-plane MPR viewers (one case each) with per-case
// crosshair navigation, segmentation overlays, CT-window presets, and an optional link that
// syncs proportional slice position across the two cases. Case ids come from the URL
// (?a=&b=) so the comparison is shareable. All Cornerstone wiring lives in
// helpers/compareViewer (isolated from the single-case viewer).
import { IconSettings } from "@tabler/icons-react";
import React, { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import OpacitySlider from "../components/OpacitySlider/OpacitySlider";
import OrganCheckbox from "../components/OrganCheckbox";
import WindowingSlider from "../components/WindowingSlider/WindowingSlider";
import { resolveSources } from "../helpers/compareSources";
import { type CompareHandle, setupCompare } from "../helpers/compareViewer";
import { segmentation_categories, segmentation_category_colors } from "../helpers/constants";
// Reuse the single viewer's design-system CSS (vp-* classes) so the compare settings
// panel is visually identical. Its rules are namespaced (vp-*) and its CSS variables
// are re-declared on .cmv below, so importing it here has no side effects on this page.
import "../routes/VisualizationPage.css";
import "./CompareViewerPage.css";

const CT_PRESETS = [
	{ name: "Soft Tissue", width: 400, center: 40 },
	{ name: "Bone", width: 1800, center: 400 },
	{ name: "Lung", width: 1500, center: -600 },
	{ name: "Liver", width: 150, center: -50 },
] as const;

type ViewMode = "mpr" | "axial" | "sagittal" | "coronal";

// 3D is omitted: the single viewer's 3D is a per-case mesh render that has no meaning in a
// two-case side-by-side layout. The other four modes match the single viewer exactly.
const VIEW_MODES: { mode: ViewMode; label: string }[] = [
	{ mode: "mpr", label: "⊞ MPR" },
	{ mode: "axial", label: "Axial" },
	{ mode: "sagittal", label: "Sag" },
	{ mode: "coronal", label: "Cor" },
];

export default function CompareViewerPage() {
	const [params] = useSearchParams();
	const idA = params.get("a") ?? "";
	const idB = params.get("b") ?? "";

	const aAx = useRef<HTMLDivElement>(null);
	const aSag = useRef<HTMLDivElement>(null);
	const aCor = useRef<HTMLDivElement>(null);
	const bAx = useRef<HTMLDivElement>(null);
	const bSag = useRef<HTMLDivElement>(null);
	const bCor = useRef<HTMLDivElement>(null);
	const handleRef = useRef<CompareHandle | null>(null);

	const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
	const [linked, setLinked] = useState(true);
	const [syncCursor, setSyncCursor] = useState(false);
	const [opacityValue, setOpacityValue] = useState(60); // 0–100, matches the single viewer
	const [activePreset, setActivePreset] = useState<string>("Soft Tissue");
	const [winWidth, setWinWidth] = useState(400);
	const [winCenter, setWinCenter] = useState(40);
	const [showSettings, setShowSettings] = useState(true);
	// Class Map panel (OrganCheckbox) open state — mirrors the single viewer's showOrganDetails.
	const [showOrganDetails, setShowOrganDetails] = useState(false);
	const [viewMode, setViewMode] = useState<ViewMode>("mpr");
	const [zoom, setZoom] = useState(1);
	// Per-organ visibility applied to BOTH cases. Index 0 = background (always on).
	const [organVisible, setOrganVisible] = useState<boolean[]>(
		() => [true, ...segmentation_categories.map(() => true)]
	);

	useEffect(() => {
		if (!idA || !idB) {
			setStatus("idle");
			return;
		}
		let cancelled = false;
		let handle: CompareHandle | null = null;
		setStatus("loading");
		(async () => {
			try {
				const [sa, sb] = await Promise.all([resolveSources(idA), resolveSources(idB)]);
				if (cancelled || !aAx.current) return;
				handle = await setupCompare(
					{
						aAx: aAx.current!, aSag: aSag.current!, aCor: aCor.current!,
						bAx: bAx.current!, bSag: bSag.current!, bCor: bCor.current!,
					},
					{ ctA: sa.ct, segA: sa.seg, ctB: sb.ct, segB: sb.seg }
				);
				if (cancelled) {
					handle.destroy();
					return;
				}
				handleRef.current = handle;
				handle.applyWindow(400, 40); // Soft Tissue default
				setStatus("ready");
			} catch (e) {
				console.error(e);
				if (!cancelled) setStatus("error");
			}
		})();
		return () => {
			cancelled = true;
			handle?.destroy();
			handleRef.current = null;
		};
	}, [idA, idB]);

	useEffect(() => {
		handleRef.current?.setLinked(linked);
	}, [linked]);
	useEffect(() => {
		handleRef.current?.setSyncCursor(syncCursor);
	}, [syncCursor]);
	useEffect(() => {
		handleRef.current?.setSegOpacity(opacityValue / 100);
	}, [opacityValue]);
	useEffect(() => {
		handleRef.current?.setOrganVisibility(organVisible);
	}, [organVisible]);
	useEffect(() => {
		handleRef.current?.applyZoom(zoom);
	}, [zoom]);
	// Re-apply the user's view settings once a fresh load is ready. A new case load builds a
	// new handle with default state (all organs on, 0.6 opacity, fit zoom), so if the user had
	// changed any of these before switching cases we push them back onto the new handle. The
	// per-setting effects above only fire on change, not on reload.
	useEffect(() => {
		if (status !== "ready") return;
		handleRef.current?.setOrganVisibility(organVisible);
		handleRef.current?.setSegOpacity(opacityValue / 100);
		handleRef.current?.applyZoom(zoom);
		// Inputs intentionally omitted: the per-setting effects handle live changes; this runs
		// only when a load completes.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [status]);
	// The viewport grid changes size when the view mode switches between MPR (3 planes) and a
	// single plane — re-fit after the layout has painted (double rAF, like the single viewer).
	useEffect(() => {
		if (status !== "ready") return;
		let raf1 = 0;
		let raf2 = 0;
		raf1 = requestAnimationFrame(() => {
			raf2 = requestAnimationFrame(() => handleRef.current?.refit());
		});
		return () => {
			cancelAnimationFrame(raf1);
			cancelAnimationFrame(raf2);
		};
	}, [viewMode, status]);

	const applyPreset = (preset: (typeof CT_PRESETS)[number]) => {
		setActivePreset(preset.name);
		setWinWidth(preset.width);
		setWinCenter(preset.center);
		handleRef.current?.applyWindow(preset.width, preset.center);
	};
	// WindowingSlider passes (width|null, center|null); fall back to the current value for
	// whichever side isn't being changed (same contract as the single viewer).
	const handleWindowChange = (newWidth: number | null, newCenter: number | null) => {
		const width = Math.max(newWidth ?? winWidth, 1);
		const center = newCenter ?? winCenter;
		setActivePreset("");
		setWinWidth(width);
		setWinCenter(center);
		handleRef.current?.applyWindow(width, center);
	};

	// OpacitySlider (Label Settings) hands 0–100 values, same as the single viewer.
	const handleOpacityOnSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = Number(e.target.value);
		setOpacityValue(value);
		handleRef.current?.setSegOpacity(value / 100);
	};
	const handleOpacityOnFormSubmit = (value: number) => {
		setOpacityValue(value);
		handleRef.current?.setSegOpacity(value / 100);
	};

	// The single viewer's shared components speak "showTaskDetails" (true = settings hidden).
	// This page tracks showSettings (true = visible), so adapt the polarity for them.
	const setShowTaskDetails: React.Dispatch<React.SetStateAction<boolean>> = (v) => {
		setShowSettings((s) => {
			const taskPrev = !s;
			const taskNext = typeof v === "function" ? v(taskPrev) : v;
			return !taskNext;
		});
	};

	const resetView = () => {
		setZoom(1);
		handleRef.current?.resetView();
	};

	// Jump both cases' crosshairs to the organ's centroid, and make sure it's visible first
	// (matches the single viewer's behaviour).
	const handleJumpToOrgan = (label: number) => {
		setOrganVisible((prev) => {
			if (prev[label]) return prev;
			const next = [...prev];
			next[label] = true;
			return next;
		});
		handleRef.current?.jumpToOrgan(label);
	};

	const bothIds = idA && idB;

	return (
		<div className="cmv">
			<div className="cmv__bar">
				<Link className="cmv__home" to={`/compare?a=${idA}&b=${idB}`} aria-label="Back to comparison">
					←
				</Link>
				<h1 className="cmv__title">
					Compare Images
					{bothIds && (
						<span className="cmv__ids">
							{" "}
							#{idA} vs #{idB}
						</span>
					)}
				</h1>
				{bothIds && (
					<button
						className={`cmv__gear${showSettings ? " is-active" : ""}`}
						onClick={() => {
							// Opening the controls also closes the Class Map, so the two panels
							// don't stack (matches the single viewer's toggle behaviour).
							setShowOrganDetails(false);
							setShowSettings((v) => !v);
						}}
						aria-label="Toggle settings"
						title="Settings"
					>
						<IconSettings size={20} stroke={2} color="white" />
					</button>
				)}
			</div>

			{!bothIds ? (
				<div className="cmv__msg">
					Provide two case ids in the URL, e.g. <code>/compare-viewer?a=1&amp;b=2</code>.
				</div>
			) : (
				<div className="cmv__body">
					{showSettings && (
						<aside className="cmv__settings vp-sidebar">
							{/* View mode */}
							<div className="vp-panel">
								<div className="vp-panel__title">View</div>
								<div className="vp-seg">
									{VIEW_MODES.map((v) => (
										<button
											key={v.mode}
											className={`vp-seg__btn ${viewMode === v.mode ? "vp-seg__btn--active" : ""}`}
											onClick={() => setViewMode(v.mode)}
										>
											{v.label}
										</button>
									))}
								</div>
							</div>

							{/* CT Window presets */}
							<div className="vp-panel">
								<div className="vp-panel__title">CT Window</div>
								<div className="vp-seg">
									{CT_PRESETS.map((preset) => (
										<button
											key={preset.name}
											className={`vp-seg__btn ${activePreset === preset.name ? "vp-seg__btn--active" : ""}`}
											onClick={() => applyPreset(preset)}
										>
											{preset.name}
										</button>
									))}
								</div>
							</div>

							{/* Label Settings + Class Map (opens the full-view organ panel) */}
							<OpacitySlider
								opacityValue={opacityValue}
								handleOpacityOnSliderChange={handleOpacityOnSliderChange}
								handleOpacityOnFormSubmit={handleOpacityOnFormSubmit}
								setShowOrganDetails={setShowOrganDetails}
								setShowTaskDetails={setShowTaskDetails}
							/>

							{/* Brightness / Contrast */}
							<WindowingSlider
								windowWidth={winWidth}
								windowCenter={winCenter}
								onWindowChange={handleWindowChange}
							/>

							{/* Zoom */}
							<div className="vp-panel">
								<div className="vp-panel__title">Zoom</div>
								<div className="flex flex-col gap-2">
									<div className="vp-row">
										<span className="vp-label">Zoom</span>
										<span className="vp-readout">{zoom.toFixed(2)}×</span>
									</div>
									<input
										type="range"
										min="0.5"
										max="2"
										step="0.11"
										aria-label="Zoom"
										className="vp-range"
										value={zoom}
										onChange={(e) => setZoom(Number(e.target.value))}
									/>
								</div>
								<div className="grid grid-cols-2 gap-2 w-full">
									<button className="vp-btn" onClick={() => handleRef.current?.centerCursor()}>
										Center Cursor
									</button>
									<button className="vp-btn" onClick={resetView}>
										Reset
									</button>
								</div>
							</div>

							{/* Sync — compare-only (no equivalent in the single viewer) */}
							<div className="vp-panel">
								<div className="vp-panel__title">Sync</div>
								<label className="cmv__toggle">
									<input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} />
									Link scroll
								</label>
								<label className="cmv__toggle">
									<input type="checkbox" checked={syncCursor} onChange={(e) => setSyncCursor(e.target.checked)} />
									Sync cursor
								</label>
							</div>
						</aside>
					)}

					{/* Class Map: full-view organ panel (slides over everything), identical to the
					    single viewer. Kept mounted so it can slide in/out. */}
					<OrganCheckbox
						setCheckState={setOrganVisible}
						checkState={organVisible}
						sessionId={undefined}
						setShowOrganDetails={setShowOrganDetails}
						showOrganDetails={showOrganDetails}
						labelColorMap={segmentation_category_colors}
						onJumpToOrgan={handleJumpToOrgan}
					/>

					<div className="cmv__grid">
					{[
						{ id: idA, ax: aAx, sag: aSag, cor: aCor },
						{ id: idB, ax: bAx, sag: bSag, cor: bCor },
					].map((row, r) => (
						<div
							className="cmv__caserow"
							key={r}
							style={viewMode === "mpr" ? undefined : { gridTemplateColumns: "1fr" }}
						>
							{([
								["Axial", "axial", row.ax],
								["Sagittal", "sagittal", row.sag],
								["Coronal", "coronal", row.cor],
							] as const).map(([label, mode, ref], c) => {
								// Keep every viewport div mounted (Cornerstone needs its element);
								// just hide the planes not in the current view mode.
								const hidden = viewMode !== "mpr" && viewMode !== mode;
								return (
									<div className="cmv__cell" key={c} style={hidden ? { display: "none" } : undefined}>
										{c === 0 && <span className="cmv__caselabel">Case {row.id}</span>}
										<span className="cmv__planelabel">{label}</span>
										<div className="cmv__viewport" ref={ref} onContextMenu={(e) => e.preventDefault()} />
									</div>
								);
							})}
						</div>
					))}

					{status === "loading" && (
						<div className="cmv__overlay">
							<span className="cmv__spinner" /> Loading both cases…
						</div>
					)}
					{status === "error" && (
						<div className="cmv__overlay cmv__overlay--err">
							Couldn't load one or both cases.
							<br />
							<span style={{ opacity: 0.7 }}>Large scans stream slowly from HuggingFace locally.</span>
						</div>
					)}
					</div>
				</div>
			)}
		</div>
	);
}
