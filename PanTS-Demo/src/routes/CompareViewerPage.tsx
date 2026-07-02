// Live side-by-side CT comparison: two 3-plane MPR viewers (one case each) with per-case
// crosshair navigation, segmentation overlays, CT-window presets, and an optional link that
// syncs proportional slice position across the two cases. Case ids come from the URL
// (?a=&b=) so the comparison is shareable. All Cornerstone wiring lives in
// helpers/compareViewer (isolated from the single-case viewer).
import { IconSettings } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { resolveSources } from "../helpers/compareSources";
import { type CompareHandle, setupCompare } from "../helpers/compareViewer";
import "./CompareViewerPage.css";

const CT_PRESETS = [
	{ name: "Soft Tissue", width: 400, center: 40 },
	{ name: "Bone", width: 1800, center: 400 },
	{ name: "Lung", width: 1500, center: -600 },
	{ name: "Liver", width: 150, center: -50 },
] as const;

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
	const [segVisible, setSegVisible] = useState(true);
	const [segOpacity, setSegOpacity] = useState(0.6);
	const [activePreset, setActivePreset] = useState<string>("Soft Tissue");
	const [winWidth, setWinWidth] = useState(400);
	const [winCenter, setWinCenter] = useState(40);
	const [showSettings, setShowSettings] = useState(true);

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
		handleRef.current?.setSegVisible(segVisible);
	}, [segVisible]);
	useEffect(() => {
		handleRef.current?.setSegOpacity(segOpacity);
	}, [segOpacity]);

	const applyPreset = (preset: (typeof CT_PRESETS)[number]) => {
		setActivePreset(preset.name);
		setWinWidth(preset.width);
		setWinCenter(preset.center);
		handleRef.current?.applyWindow(preset.width, preset.center);
	};
	const applyManualWindow = (width: number, center: number) => {
		setActivePreset("");
		setWinWidth(width);
		setWinCenter(center);
		handleRef.current?.applyWindow(width, center);
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
						onClick={() => setShowSettings((v) => !v)}
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
						<aside className="cmv__settings">
							<div className="cmv-panel">
								<div className="cmv-panel__title">View</div>
								<button className="cmv-panel__btn" onClick={() => handleRef.current?.resetView()}>
									Reset view
								</button>
							</div>

							<div className="cmv-panel">
								<div className="cmv-panel__title">CT Window</div>
								<div className="cmv-seg">
									{CT_PRESETS.map((p) => (
										<button
											key={p.name}
											className={`cmv-seg__btn${activePreset === p.name ? " is-active" : ""}`}
											onClick={() => applyPreset(p)}
										>
											{p.name}
										</button>
									))}
								</div>
								<label className="cmv-slider">
									<span>Width</span>
									<input
										type="range"
										min={1}
										max={2000}
										value={winWidth}
										onChange={(e) => applyManualWindow(Number(e.target.value), winCenter)}
									/>
									<em>{winWidth}</em>
								</label>
								<label className="cmv-slider">
									<span>Center</span>
									<input
										type="range"
										min={-1000}
										max={1000}
										value={winCenter}
										onChange={(e) => applyManualWindow(winWidth, Number(e.target.value))}
									/>
									<em>{winCenter}</em>
								</label>
							</div>

							<div className="cmv-panel">
								<div className="cmv-panel__title">Segmentation</div>
								<label className="cmv__toggle">
									<input type="checkbox" checked={segVisible} onChange={(e) => setSegVisible(e.target.checked)} />
									Show overlay
								</label>
								<label className="cmv-slider">
									<span>Opacity</span>
									<input
										type="range"
										min={0}
										max={100}
										value={Math.round(segOpacity * 100)}
										onChange={(e) => setSegOpacity(Number(e.target.value) / 100)}
										disabled={!segVisible}
									/>
									<em>{Math.round(segOpacity * 100)}%</em>
								</label>
							</div>

							<div className="cmv-panel">
								<div className="cmv-panel__title">Sync</div>
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

					<div className="cmv__grid">
					{[
						{ id: idA, ax: aAx, sag: aSag, cor: aCor },
						{ id: idB, ax: bAx, sag: bSag, cor: bCor },
					].map((row, r) => (
						<div className="cmv__caserow" key={r}>
							{([
								["Axial", row.ax],
								["Sagittal", row.sag],
								["Coronal", row.cor],
							] as const).map(([label, ref], c) => (
								<div className="cmv__cell" key={c}>
									{c === 0 && <span className="cmv__caselabel">Case {row.id}</span>}
									<span className="cmv__planelabel">{label}</span>
									<div className="cmv__viewport" ref={ref} onContextMenu={(e) => e.preventDefault()} />
								</div>
							))}
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
