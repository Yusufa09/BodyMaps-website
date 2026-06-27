import type { RenderingEngine } from "@cornerstonejs/core";
import type { Color, ColorLUT } from "@cornerstonejs/core/types";
import type { vtkVolumeProperty } from '@kitware/vtk.js/Rendering/Core/VolumeProperty';
import { Niivue } from "@niivue/niivue";
import {
    IconChartBar,
    IconCheck,
    IconClick,
    IconDownload, IconHome, IconPointer, IconReport,
    IconRuler2,
    IconSettings,
    IconShare,
    IconSquareDashed,
    IconTrash
} from "@tabler/icons-react";
import React, { lazy, Suspense, useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import ErrorBoundary from "../components/ErrorBoundary";
import OpacitySlider from "../components/OpacitySlider/OpacitySlider";
import OrganCheckbox from "../components/OrganCheckbox";
import ReportScreen from "../components/ReportScreen/ReportScreen";
import SnakeGame from "../components/SnakeGame/SnakeGame";
import WindowingSlider from "../components/WindowingSlider/WindowingSlider";
import ZoomHandle from "../components/zoomHandle";
import {
    clearMeasurements,
    getCrosshairMm,
    getOrganCentroids,
    getOrganLabelOnClick,
    LENGTH_TOOL,
    type MeasurementToolName,
    moveCornerstoneCrosshairToMm,
    PROBE_TOOL,
    renderVisualization,
    ROI_TOOL,
    setActiveMeasurementTool,
    setToolGroupOpacity,
    setVisibilities,
    subscribeToCrosshairChanges,
    subscribeToVolumeProgress,
    toggleCrosshairTool
} from "../helpers/CornerstoneNifti2";
import { create3DVolume, moveNiiVueCrosshairToMm, updateVisibilities } from "../helpers/NiiVueNifti";
import { decodeViewerState, encodeViewerState } from "../helpers/viewerShareState";
import {
    API_BASE,
    APP_CONSTANTS,
    segmentation_categories,
    segmentation_category_colors,
} from "../helpers/constants";
import { filenameToName, getPanTSId } from "../helpers/utils";
import { type CheckBoxData, type NColorMap } from "../types";
import "./VisualizationPage.css";

type ViewMode = "mpr" | "axial" | "sagittal" | "coronal" | "3d";

type OrganStat = { organ_name: string; volume_cm3: number; mean_hu: number };

// 3D organ loading animation (three.js) — lazy so its chunk loads alongside the
// volume download rather than bloating the main viewer bundle.
const RotatingModelLoader = lazy(() => import("../components/Loading"));

const CT_PRESETS = [
	{ name: "Soft Tissue", width: 400, center: 40 },
	{ name: "Bone", width: 1800, center: 400 },
	{ name: "Lung", width: 1500, center: -600 },
	{ name: "Liver", width: 150, center: -50 }, // Brightness 50 (= -center), Contrast 150 (= width)
] as const;

// Measurement tools shown inside the collapsible "Measure" flyout, so the toolbar isn't
// crowded with one button per tool (matches the split-button pattern OHIF uses).
const MEASURE_TOOLS: { name: MeasurementToolName; label: string; Icon: typeof IconRuler2 }[] = [
	{ name: LENGTH_TOOL, label: "Distance (mm)", Icon: IconRuler2 },
	{ name: PROBE_TOOL, label: "HU at point", Icon: IconClick },
	{ name: ROI_TOOL, label: "ROI · HU & area", Icon: IconSquareDashed },
];

function VisualizationPage() {
	// References and state
	const params = useParams();
	const pantsCase = params.caseId;
	const sessionId = params.sessionId;

	// Where to load the volumes from. Per the maintainer's rule, dataset cases load
	// from the lab's LOCAL endpoints (served off disk on the JHU server — much faster
	// for big full-body scans than streaming the .nii.gz from HuggingFace). We probe
	// the local file and only fall back to the public HuggingFace mirror when it isn't
	// present (e.g. a dev checkout without the image data), so the viewer never breaks.
	const displayId = pantsCase ?? sessionId ?? "1";
	const [ctUrl, setCtUrl] = useState<string | null>(null);
	const [segUrl, setSegUrl] = useState<string | null>(null);
	// Whether the local volumes exist (enables the HD toggle). Dataset cases default to
	// the low-res copy for fast loading; ?hd=1 in the URL requests full resolution.
	const [localAvailable, setLocalAvailable] = useState(false);
	const isHd =
		typeof window !== "undefined" &&
		new URLSearchParams(window.location.search).get("hd") === "1";

	useEffect(() => {
		let cancelled = false;
		const resolveSources = async () => {
			if (sessionId) {
				setCtUrl(`${API_BASE}/api/session-ct/${sessionId}`);
				setSegUrl(`${API_BASE}/api/session-segmentation/${sessionId}`);
				return;
			}
			const id = pantsCase ?? "1";
			const p = getPanTSId(id);
			const localCt = `${API_BASE}/api/get-main-nifti/${id}`;
			const localSeg = `${API_BASE}/api/get-segmentations/${id}`;
			const hfCt = `https://huggingface.co/datasets/BodyMaps/iPanTSMini/resolve/main/image_only/${p}/ct.nii.gz?download=true`;
			const hfSeg = `https://huggingface.co/datasets/BodyMaps/iPanTSMini/resolve/main/mask_only/${p}/combined_labels.nii.gz?download=true`;
			// HEAD probe: fast, doesn't download the volume; 404/500 → use HF fallback.
			const localOk = await fetch(localCt, { method: "HEAD" }).then((r) => r.ok).catch(() => false);
			if (cancelled) return;
			setLocalAvailable(localOk);
			// Local: low-res by default (server falls back to full if not yet generated),
			// full res when ?hd=1. HuggingFace fallback is full res only.
			const resParam = isHd ? "" : "?res=low";
			setCtUrl(localOk ? `${localCt}${resParam}` : hfCt);
			setSegUrl(localOk ? `${localSeg}${resParam}` : hfSeg);
		};
		resolveSources();
		return () => { cancelled = true; };
	}, [pantsCase, sessionId, isHd]);

	// Flip between low-res and full-res by reloading the route — a fresh mount cleanly
	// re-inits the Cornerstone/NiiVue contexts (re-running them in place is fragile).
	const toggleHd = () => {
		const params = new URLSearchParams(window.location.search);
		if (isHd) params.delete("hd");
		else params.set("hd", "1");
		const qs = params.toString();
		window.location.href = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
	};

	const axial_ref = useRef<HTMLDivElement>(null);
	const sagittal_ref = useRef<HTMLDivElement>(null);
	const coronal_ref = useRef<HTMLDivElement>(null);
	const render_ref = useRef<HTMLCanvasElement>(null);
	const cmapRef = useRef<NColorMap>(null);
	// const TaskMenu_ref = useRef(null);
	const VisualizationContainer_ref = useRef(null);
	//   const lastClickInfoRef = useRef(null);

	//   const [sliceAxial, setSliceAxial] = useState(0);
	//   const [sliceSagittal, setSliceSagittal] = useState(0);
	//   const [sliceCoronal, setSliceCoronal] = useState(0);
	const [checkState, setCheckState] = useState<boolean[]>([true]);
	useState<string[] | null>(null);
	const [NV, setNV] = useState<Niivue | undefined>();
	const [sessionKey, _setSessionKey] = useState<string | undefined>(undefined);
	const [checkBoxData, setCheckBoxData] = useState<CheckBoxData[]>([]);
	const [opacityValue, setOpacityValue] = useState(
		APP_CONSTANTS.DEFAULT_SEGMENTATION_OPACITY * 100
	);
	const [windowWidth, setWindowWidth] = useState(400);
	const [windowCenter, setWindowCenter] = useState(50);
	const [renderingEngine, setRenderingEngine] =
		useState<RenderingEngine | null>(null);
	const [viewportIds, setViewportIds] = useState<string[]>([]);
	const [volumeId, setVolumeId] = useState<string | null>(null);
	const [showReportScreen, setShowReportScreen] = useState(false);
	const [showStats, setShowStats] = useState(false);
	const [organStats, setOrganStats] = useState<OrganStat[] | null>(null);
	const [statsLoading, setStatsLoading] = useState(false);
	const [statsError, setStatsError] = useState(false);
	// Measured download progress for the loading screen (from the nifti loader's real
	// bytes-loaded/total — accurate, not a guess).
	const [dlPct, setDlPct] = useState<number | null>(null);
	const [dlDone, setDlDone] = useState(false);
	const dlTotalsRef = useRef<Record<string, number>>({});
	const [showTaskDetails, setShowTaskDetails] = useState(true);
	const [showOrganDetails, setShowOrganDetails] = useState(false);
	const [loading, setLoading] = useState(true);
	const [labelColorMap, _setLabelColorMap] = useState<{ [key: number]: Color }>(
		segmentation_category_colors
	);
	const [zoomMode, setZoomMode] = useState(false);
	const [zoomLevel, setZoomLevel] = useState(1);
	const [crosshairToolActive, setCrosshairToolActive] = useState(true);
	// Which measurement tool owns the primary mouse button (null = navigation/crosshair).
	const [activeMeasureTool, setActiveMeasureTool] = useState<MeasurementToolName | null>(null);
	// Collapsible measurement-tools flyout (declutters the toolbar). The menu renders in a
	// portal at a fixed position so it isn't clipped by the scrollable settings panel.
	const [measureMenuOpen, setMeasureMenuOpen] = useState(false);
	const [measureMenuPos, setMeasureMenuPos] = useState<{ top: number; left: number } | null>(null);
	const measureGroupRef = useRef<HTMLDivElement>(null);
	const measureBtnRef = useRef<HTMLButtonElement>(null);
	const measureMenuRef = useRef<HTMLDivElement>(null);

	const toggleMeasureMenu = () => {
		setMeasureMenuOpen((open) => {
			const next = !open;
			if (next && measureBtnRef.current) {
				const r = measureBtnRef.current.getBoundingClientRect();
				setMeasureMenuPos({ top: r.top, left: r.right + 10 });
			}
			return next;
		});
	};
	// Shareable-link state: brief "copied" confirmation, and a guard so a deep-link's view
	// state is applied exactly once after the volume finishes loading.
	const [shareCopied, setShareCopied] = useState(false);
	const shareStateAppliedRef = useRef(false);
	const [viewMode, setViewMode] = useState<ViewMode>("mpr");
	const [activePreset, setActivePreset] = useState<string>("Soft Tissue");
	const [tooltip, setToolTip] = useState({
		visible: false,	
		x: 0,
		y: 0,
		text: "",
	});

	// const location = useLocation();
	// Load and render visualization on first render

	useEffect(() => {
		// A measurement tool, when active, owns the primary button — don't let the
		// crosshair/pan toggle fight it for control.
		if (activeMeasureTool) return;
		toggleCrosshairTool(crosshairToolActive);
	}, [crosshairToolActive, activeMeasureTool]);

	// Close the measurement flyout on an outside click, or when the panel scrolls/resizes
	// (the portal menu is fixed-positioned, so it would otherwise detach from the button).
	useEffect(() => {
		if (!measureMenuOpen) return;
		const onPointerDown = (e: globalThis.MouseEvent) => {
			const t = e.target as Node;
			if (measureGroupRef.current?.contains(t) || measureMenuRef.current?.contains(t)) return;
			setMeasureMenuOpen(false);
		};
		const onReflow = () => setMeasureMenuOpen(false);
		document.addEventListener("mousedown", onPointerDown);
		window.addEventListener("scroll", onReflow, true);
		window.addEventListener("resize", onReflow);
		return () => {
			document.removeEventListener("mousedown", onPointerDown);
			window.removeEventListener("scroll", onReflow, true);
			window.removeEventListener("resize", onReflow);
		};
	}, [measureMenuOpen]);

	// Hand the primary mouse button to the chosen measure tool, or back to navigation.
	useEffect(() => {
		if (activeMeasureTool) {
			setActiveMeasurementTool(activeMeasureTool);
		} else {
			setActiveMeasurementTool(null);
			toggleCrosshairTool(crosshairToolActive);
		}
		// crosshairToolActive intentionally omitted: the effect above re-applies nav when
		// the crosshair/pan toggle changes; here we only react to the measure-tool switch.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activeMeasureTool]);

	// Track the CT download to show an accurate ETA while the case loads. We follow the
	// largest-total stream (the CT volume, not the smaller segmentation) and derive the
	// remaining time from the average measured throughput since the download started.
	useEffect(() => {
		if (!loading) return;
		dlTotalsRef.current = {};
		setDlPct(null);
		setDlDone(false);
		const unsub = subscribeToVolumeProgress((loaded, total, volumeId) => {
			if (!total || total <= 0) return;
			dlTotalsRef.current[volumeId] = total;
			// Only track the biggest volume (CT); ignore the smaller seg progress stream.
			let biggestId = volumeId;
			let biggestTotal = 0;
			for (const [id, t] of Object.entries(dlTotalsRef.current)) {
				if (t > biggestTotal) { biggestTotal = t; biggestId = id; }
			}
			if (volumeId !== biggestId) return;
			if (loaded >= total) { setDlDone(true); setDlPct(100); return; }
			if (loaded > 0) {
				setDlPct(Math.min(100, Math.max(0, Math.round((loaded / total) * 100))));
			}
		});
		return unsub;
	}, [loading, ctUrl]);

	useEffect(() => {
		const setup = async () => {
			// const state = location.state;
			// if (!state) {
			// alert('No Nifti Files Uploaded!');
			// navigate('/');
			// return;
			// }

			const checkBoxData = segmentation_categories.map((filename, i) => ({
				label: filenameToName(filename),
				id: i + 1,
			}));
			setCheckBoxData(checkBoxData);
			const initialState = [true]; // background 永远可见
			checkBoxData.forEach((item) => {
				initialState[item.id] = true;
			});
			setCheckState(initialState);
			const max = Math.max(
				...Object.keys(labelColorMap).map((key) => parseInt(key))
			);

			const cmap: ColorLUT = Array.from({ length: max + 1 }, () => [
				0, 0, 0, 0,
			]);
			for (const key in labelColorMap) {
				cmap[parseInt(key)] = labelColorMap[parseInt(key)];
			}
			if (
				!ctUrl ||
				!segUrl ||
				!axial_ref.current ||
				!sagittal_ref.current ||
				!coronal_ref.current ||
				!render_ref.current ||
				cmap.length === 0
			)
				return;

			const result = await renderVisualization(
				axial_ref.current,
				sagittal_ref.current,
				coronal_ref.current,
				cmap,
				ctUrl,
				segUrl,
				setLoading
			);

			// setLoading(false);
			if (!result) return;
			const {
				renderingEngine,
				viewportIds,
				volumeId,
			} = result;

			setRenderingEngine(renderingEngine);
			setViewportIds(viewportIds);
			setVolumeId(volumeId);
			const { nv, cmapCopy } = await create3DVolume(
				render_ref,
				segUrl,
				labelColorMap,
				(mm) => moveCornerstoneCrosshairToMm(mm as [number, number, number])
			);
			cmapRef.current = cmapCopy;
			setNV(nv);

			// Cornerstone → NiiVue: when crosshair moves in any 2D view, sync to 3D
			subscribeToCrosshairChanges((mm) => {
				moveNiiVueCrosshairToMm(nv, mm);
			});
		};

		setup();
	}, [
		ctUrl,
		segUrl,
		axial_ref,
		sagittal_ref,
		coronal_ref,
		render_ref,
		labelColorMap,
	]);
	// Toggle checkbox state
	//   useEffect(() => {
	//   const fetchColorMap = async () => {
	//     try {
	//       // const cached = sessionStorage.getItem(cacheKey);
	//       // if (cached) {
	//       //   setLabelColorMap(JSON.parse(cached));
	//       //   return;
	//       // }
	//       setProgress(0.15)
	//       const response = await fetch(`${APP_CONSTANTS.API_ORIGIN}/api/get-label-colormap/${pantsCase}`);
	//       const lut = await response.json();
	//       const parsedMap: {[key: number]: Color}= {};
	//       for (const labelId in lut) {
	//         const color = lut[labelId];
	//         if (color && color.R !== undefined) {
	//           const arr: Color = [color.R, color.G, color.B, color.A ?? 255];
	//           parsedMap[Number(labelId)] = arr;
	//         }
	//       }
	//       setLabelColorMap(parsedMap);

	//       setProgress(0.7)
	//     } catch (err) {
	//       console.warn("❗ Failed to fetch colormap:", err);
	//     }
	//   };

	//   fetchColorMap();
	// }, [pantsCase]);

	// Update VOI (window/level) settings
	const handleWindowChange = (
		newWidth: number | null,
		newCenter: number | null
	) => {
		const _width = Math.max(newWidth ?? windowWidth, 1);
		const _center = newCenter ?? windowCenter;

		setWindowWidth(_width);
		setWindowCenter(_center);

		if (!renderingEngine || !viewportIds.length || !volumeId) return;

		const windowLow = _center - _width / 2;
		const windowHigh = _center + _width / 2;

		viewportIds.forEach((viewportId) => {
			const viewport = renderingEngine.getViewport(viewportId);
			const actor = viewport.getDefaultActor();

			const tf = (actor.actor.getProperty() as vtkVolumeProperty).getRGBTransferFunction(0);
			tf.setMappingRange(windowLow, windowHigh);
			tf.updateRange();
			viewport.render();
		});
	};

	// Apply window settings once the engine/viewports/volume are ready. Intentionally not
	// keyed on windowWidth/Center/handleWindowChange — the slider already applies live
	// changes; this just seeds the initial window after load.
	useEffect(() => {
		if (renderingEngine && viewportIds.length && volumeId) {
			handleWindowChange(windowWidth, windowCenter);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [renderingEngine, viewportIds, volumeId]);

	// Apply a shared deep-link's view state once the volume is ready (orientation, window,
	// opacity, hidden organs, crosshair). Runs a single time — after that the URL is just a
	// snapshot and the user is free to change things.
	useEffect(() => {
		if (shareStateAppliedRef.current || loading) return;
		if (!renderingEngine || !viewportIds.length || !volumeId) return;
		shareStateAppliedRef.current = true;

		const shared = decodeViewerState(new URLSearchParams(window.location.search));
		if (shared.view) setViewMode(shared.view);
		if (shared.ww != null && shared.wc != null) handleWindowChange(shared.ww, shared.wc);
		if (shared.opacity != null) {
			setOpacityValue(shared.opacity);
			setToolGroupOpacity(shared.opacity);
		}
		if (shared.hidden?.length) {
			// The checkState effect below applies the visibility change (Cornerstone + NiiVue).
			setCheckState((prev) => {
				const next = [...prev];
				for (const id of shared.hidden!) if (id < next.length) next[id] = false;
				return next;
			});
		}
		// Move the crosshair last, after a paint, so the viewports are laid out and the
		// reference lines land on the intended focal point.
		if (shared.crosshair) {
			requestAnimationFrame(() => moveCornerstoneCrosshairToMm(shared.crosshair!));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [loading, renderingEngine, viewportIds, volumeId]);

	// Build a shareable URL that reproduces the current view, and copy it to the clipboard.
	const handleShare = async () => {
		const hidden = checkState.reduce<number[]>((acc, visible, id) => {
			if (id > 0 && !visible) acc.push(id);
			return acc;
		}, []);
		const params = encodeViewerState({
			view: viewMode,
			ww: windowWidth,
			wc: windowCenter,
			opacity: opacityValue,
			hidden,
			crosshair: getCrosshairMm() ?? undefined,
			hd: isHd,
		});
		const qs = params.toString();
		const url = `${window.location.origin}${window.location.pathname}${qs ? `?${qs}` : ""}`;
		try {
			await navigator.clipboard.writeText(url);
		} catch {
			// Clipboard blocked (e.g. insecure context) — fall back to a prompt so the link
			// is still copyable by hand.
			window.prompt("Copy this link to share the current view:", url);
		}
		setShareCopied(true);
		window.setTimeout(() => setShareCopied(false), 1600);
	};

	// The Measure button shows the active tool's icon (or the ruler when none is active).
	const ActiveMeasureIcon = MEASURE_TOOLS.find((t) => t.name === activeMeasureTool)?.Icon ?? IconRuler2;

	// Center on an organ (from the sidebar): move both the 2D MPR crosshair and the 3D
	// (NiiVue) crosshair — the Cornerstone move suppresses its change event, so the 3D
	// view has to be synced explicitly — and make sure the organ is visible there.
	const handleJumpToOrgan = (label: number) => {
		const centroid = getOrganCentroids()?.[label];
		if (!centroid) return; // organ not present in this scan
		moveCornerstoneCrosshairToMm(centroid);
		if (NV) moveNiiVueCrosshairToMm(NV, centroid);
		setCheckState((prev) => {
			if (prev[label]) return prev;
			const next = [...prev];
			next[label] = true;
			return next;
		});
	};

	// Resize Cornerstone + NiiVue when view mode changes. resize(immediate, keepCamera):
	// keepCamera defaults to true, which preserved the zoom/pan from a single (fullscreen)
	// view when returning to MPR — leaving the image zoomed/offset. Pass false and reset
	// each camera so every viewport cleanly re-fits its new size.
	useEffect(() => {
		// Run after the grid/layout change has been applied AND painted (double rAF), so
		// resize() measures the final element sizes — a fixed timeout could fire too early
		// and bake in a wrong canvas size (panes ending up smaller than their cells).
		let raf1 = 0;
		let raf2 = 0;
		const apply = () => {
			if (renderingEngine) {
				renderingEngine.resize(true, false);
				viewportIds.forEach((id) => {
					const vp = renderingEngine.getViewport(id) as { resetCamera?: () => void };
					vp?.resetCamera?.();
				});
				renderingEngine.render();
			}
			if (NV) NV.resizeListener();
		};
		raf1 = requestAnimationFrame(() => {
			raf2 = requestAnimationFrame(apply);
		});
		return () => {
			cancelAnimationFrame(raf1);
			cancelAnimationFrame(raf2);
		};
	}, [viewMode, renderingEngine, NV, viewportIds]);

	const handlePresetClick = (preset: typeof CT_PRESETS[number]) => {
		setActivePreset(preset.name);
		handleWindowChange(preset.width, preset.center);
	};

	const panelStyle = (panel: "axial" | "sagittal" | "coronal" | "3d"): React.CSSProperties => {
		if (viewMode === "mpr") return {};
		// 3D: overlay the render pane fullscreen but LEAVE the Cornerstone panes untouched
		// in their grid cells. The render pane is the *last* grid item, so pulling it out of
		// flow doesn't reflow the other three — their viewports stay valid, so switching back
		// to MPR is instant (no resize/re-fit of the 2D views, no animation, correct sizes).
		if (viewMode === "3d") {
			return panel === "3d" ? { position: "absolute", inset: 0, zIndex: 20 } : {};
		}
		// 2D single view: collapse the grid to one cell and hide the rest.
		return viewMode === panel ? {} : { display: "none" };
	};

	// Update segmentation visibility when state changes
	useEffect(() => {
		if (checkState && NV) {
			const checkStateArr = [
				true, // ID=0 background 永远可见
				...checkBoxData.map((item) => !!checkState[item.id]),
			];
			// const visible = checkStateArr.map((item, idx) => item === true ? idx - 1 : null).filter((item) => item !== null);
			// if (visible.length !== checkBoxData.length+1 && visible.length !== 1) {
			// 	visible.splice(0, 1);
			// 	console.log(visible.map((item) => segmentation_categories[item]));
			// 	create3DVolumeFew(render_ref, labelColorMap, getPanTSId(pantsCase ?? "1"), visible);
			// }
			// else {
			updateVisibilities(NV, checkStateArr, sessionKey, cmapRef.current);
			// }
			setVisibilities(checkStateArr);
		}
	}, [
		checkState,
		NV,
		checkBoxData,
		sessionKey,
	]);

	const handleOpacityOnSliderChange = (
		event: React.ChangeEvent<HTMLInputElement>
	) => {
		const value = Number(event.target.value);
		setOpacityValue(value);
		setToolGroupOpacity(value / 100);
		// updateGeneralOpacity(render_ref, value / 100);
	};

	const handleOpacityOnFormSubmit = (value: number) => {
		setOpacityValue(value);
		setToolGroupOpacity(value / 100);
		// updateGeneralOpacity(render_ref, value / 100);
	};

	// Per-organ volume (cm³) + mean HU — the existing quantitative layer the backend
	// already computes for the PDF report, surfaced inline. Fetched once, on first open.
	const loadOrganStats = async () => {
		if (organStats || statsLoading) return;
		setStatsLoading(true);
		setStatsError(false);
		try {
			const fd = new FormData();
			fd.append("sessionKey", String(displayId));
			const res = await fetch(`${API_BASE}/api/mask-data`, { method: "POST", body: fd });
			const data = await res.json();
			// The endpoint returns its errors with HTTP 200 + an `error` field, so check both.
			if (!res.ok || data.error) {
				throw new Error(data.error || `HTTP ${res.status}`);
			}
			setOrganStats((data.organ_metrics ?? []) as OrganStat[]);
		} catch (e) {
			console.error(e);
			setStatsError(true);
		} finally {
			setStatsLoading(false);
		}
	};

	const handleToggleStats = () => {
		setShowStats((v) => !v);
		loadOrganStats();
	};

	const handleDownloadClick = async () => {
		const downloadUrl = sessionId
			? `${API_BASE}/api/get_result/${sessionId}`
			: `${API_BASE}/api/download/${pantsCase}`;
		const response = await fetch(downloadUrl);
		const blob = await response.blob();
		const url = window.URL.createObjectURL(blob);

		const link = document.createElement("a");
		link.href = url;
		link.download = `${displayId}_segmentations.zip`;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		window.URL.revokeObjectURL(url);
	};

	const handleMouseClick = async (e: MouseEvent) => {
		const idx = getOrganLabelOnClick();
		if (idx === undefined || typeof idx !== "number") {
			setToolTip({
				visible: false,
				x: 0,
				y: 0,
				text: "",
			})
			return;
		};
		const label = segmentation_categories[idx-1];
		setToolTip({
			visible: true,
			x: e.clientX + 10,
			y: e.clientY + 10,
			text: label
		});
	};

	const navBack = () => {
		window.location.href = "/dashboard";
	};
	// const PREVIEW_IDS = [1, 17, 30, 35, 121];

	// if (PREVIEW_IDS.filter((id) => id === Number(pantsCase)).length === 0) {
	// 	navigate("/");
	// 	return null;
	// }

	return (
		<div
			className="VisualizationPage"
			style={{
				display: "flex",
				overflow: "hidden",
				flexDirection: "column",
				height: "100vh",
				width: "100vw",
			}}
		>
			<div style={{ position: "relative" }}>
				{/* Branded viewer top bar — pointer-events-none so CT pane clicks pass through */}
				<div className="pointer-events-none absolute top-0 left-0 z-10 flex w-full items-center justify-between bg-gradient-to-b from-black/75 via-black/35 to-transparent px-6 pt-3 pb-8">
					{/* spacer keeps the wordmark clear of the settings/home buttons */}
					<div className="pointer-events-auto flex w-32 shrink-0 justify-end" />
				</div>
				<div className="sidebar" style={{ position: 'fixed', top: 0, left: 0, zIndex: 50 }}>
					<div>
						<div className="flex" style={{ position: 'fixed', top: 0, left: 0, zIndex: 50, padding: '16px 0 0 16px', gap: '8px' }}>
							<button
								className="vp-iconbtn"
								title="Toggle controls"
								aria-label="Toggle controls"
								onClick={() => {
									// Opening the controls must also close the Organs panel, otherwise the
									// two slide-in panels stack on top of each other.
									setShowOrganDetails(false);
									setShowTaskDetails((prev) => !prev);
								}}
							>
								<IconSettings size={20} color="white" />
							</button>
							<button
								className="vp-iconbtn"
								title="Back to dashboard"
								aria-label="Back to dashboard"
								onClick={() => navBack()}
							>
								<IconHome size={20} color="white" />
							</button>
						</div>
						<div
							className={`vp-sidebar w-64 h-dvh p-4 pt-16 gap-3 flex flex-col overflow-y-auto transition-all duration-300 ease-in-out origin-left ${showTaskDetails ? "translate-x-[-64rem]" : "translate-x-0"}`}
							style={{ position: 'fixed', top: 0, left: 0, zIndex: 49 }}
						>
							{/* Toggle dropdown */}

							{!showTaskDetails && (
								<>
									{zoomMode ? null : (
										<div className="flex flex-col gap-1 items-start text-left px-1">
											<span className="vp-case-eyebrow">{sessionId ? "Session" : "Case"}</span>
											<span className="vp-case-id">{displayId}</span>
										</div>
									)}

									<>
										{/* View mode */}
									<div className="vp-panel">
										<div className="vp-panel__title">View</div>
										<div className="vp-seg">
											{([
												{ mode: "mpr" as ViewMode, label: "⊞ MPR" },
												{ mode: "axial" as ViewMode, label: "Axial" },
												{ mode: "sagittal" as ViewMode, label: "Sag" },
												{ mode: "coronal" as ViewMode, label: "Cor" },
												{ mode: "3d" as ViewMode, label: "3D" },
											]).map(({ mode, label }) => (
												<button
													key={mode}
													onClick={() => setViewMode(mode)}
													className={`vp-seg__btn ${viewMode === mode ? "vp-seg__btn--active" : ""}`}
												>{label}</button>
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
													onClick={() => handlePresetClick(preset)}
													className={`vp-seg__btn ${activePreset === preset.name ? "vp-seg__btn--active" : ""}`}
												>{preset.name}</button>
											))}
										</div>
									</div>

									<OpacitySlider
										opacityValue={opacityValue}
										handleOpacityOnSliderChange={
											handleOpacityOnSliderChange
										}
										handleOpacityOnFormSubmit={handleOpacityOnFormSubmit}
										setShowOrganDetails={setShowOrganDetails}
										setShowTaskDetails={setShowTaskDetails}
									/>

										<WindowingSlider
											windowWidth={windowWidth}
											windowCenter={windowCenter}
											onWindowChange={handleWindowChange}
										/>
										<ZoomHandle
											submitted={zoomLevel}
											setSubmitted={setZoomLevel}
											setZoomMode={setZoomMode}
										/>
									</>

									{/* Report Download Zoom Buttons */}
									{/* Opacity & Windowing Sliders */}
									{/* {!zoomMode ? ( */}
									<>

										<div className="vp-toolrow">
											<button
												className={`vp-tool ${crosshairToolActive && !activeMeasureTool ? "vp-tool--active" : ""}`}
												onClick={() => {
													setActiveMeasureTool(null);
													setCrosshairToolActive((prev) => !prev);
												}}
												aria-label="Crosshair mode"
											>
												<IconPointer size={20} color={crosshairToolActive && !activeMeasureTool ? "#08090b" : "white"} />
												<span className="vp-tool__tip">Crosshair</span>
											</button>
											<div className="vp-toolgroup" ref={measureGroupRef}>
												<button
													ref={measureBtnRef}
													className={`vp-tool ${activeMeasureTool || measureMenuOpen ? "vp-tool--active" : ""}`}
													onClick={toggleMeasureMenu}
													aria-label="Measurement tools"
													aria-haspopup="menu"
													aria-expanded={measureMenuOpen}
												>
													<ActiveMeasureIcon size={20} color={activeMeasureTool || measureMenuOpen ? "#08090b" : "white"} />
													<span className="vp-tool__caret" />
													<span className="vp-tool__tip">Measure</span>
												</button>
												{measureMenuOpen && measureMenuPos &&
													createPortal(
														<div
															className="vp-flyout"
															role="menu"
															ref={measureMenuRef}
															style={{ position: "fixed", top: measureMenuPos.top, left: measureMenuPos.left }}
														>
															{MEASURE_TOOLS.map(({ name, label, Icon }) => (
																<button
																	key={name}
																	className={`vp-flyout__item ${activeMeasureTool === name ? "is-active" : ""}`}
																	role="menuitem"
																	onClick={() => {
																		setActiveMeasureTool((p) => (p === name ? null : name));
																		setMeasureMenuOpen(false);
																	}}
																>
																	<Icon size={18} />
																	<span>{label}</span>
																</button>
															))}
															<button
																className="vp-flyout__item"
																role="menuitem"
																onClick={() => {
																	clearMeasurements();
																	setMeasureMenuOpen(false);
																}}
															>
																<IconTrash size={18} />
																<span>Clear measurements</span>
															</button>
														</div>,
														document.body
													)}
											</div>
											<button
												className={`vp-tool ${shareCopied ? "vp-tool--active" : ""}`}
												onClick={handleShare}
												aria-label="Copy a shareable link to this view"
											>
												{shareCopied ? (
													<IconCheck size={20} color="#08090b" />
												) : (
													<IconShare size={20} color="white" />
												)}
												<span className="vp-tool__tip">{shareCopied ? "Link copied!" : "Share this view"}</span>
											</button>
											{/* <div className="group cursor-pointer rounded-md relative">
													{!zoomMode ? (
														<>
															<div className="border-gray-500 hover:bg-gray-700 border rounded-md p-2">

															<IconZoom
																onClick={() => setZoomMode(true)}
																className="w-6 h-6 text-white relative"
																></IconZoom>
															</div>
															<span className="transition-all pointer-events-none duration-100 scale-0 group-hover:scale-100 absolute top-0 left-12 z-1 bg-gray-900 text-white rounded-md p-2">
																Zoom
															</span>
														</>
													) : null }
												</div> */}

											<button
												className="vp-tool"
												onClick={handleDownloadClick}
												aria-label="Download segmentations"
											>
												<IconDownload size={20} color="white" />
												<span className="vp-tool__tip">Download</span>
											</button>
											<button
												className="vp-tool"
												onClick={() => setShowReportScreen(true)}
												aria-label="Open report"
											>
												<IconReport size={20} color="white" />
												<span className="vp-tool__tip">Report</span>
											</button>
											<button
												className={`vp-tool ${showStats ? "vp-tool--active" : ""}`}
												onClick={handleToggleStats}
												aria-label="Organ statistics"
											>
												<IconChartBar size={20} color={showStats ? "#08090b" : "white"} />
												<span className="vp-tool__tip">Organ stats</span>
											</button>
											{!sessionId && localAvailable && (
												<button
													className={`vp-tool ${isHd ? "vp-tool--active" : ""}`}
													onClick={toggleHd}
													aria-label={isHd ? "Switch to fast (low-res)" : "Load full resolution"}
												>
													<span style={{ fontFamily: "var(--vp-mono)", fontSize: "12px", fontWeight: 700 }}>HD</span>
													<span className="vp-tool__tip">{isHd ? "Full res · click for fast" : "Load full resolution"}</span>
												</button>
											)}
										</div>
									</>
									{/* ) : null} */}
								</>
							)}
						</div>
					</div>
				</div>

				{/* {
          loading ?
          <div className="flex z-3 absolute top-0 left-0 w-screen h-screen items-center justify-center">
              <div role="status">
                  <svg aria-hidden="true" className="w-8 h-8 text-gray-200 animate-spin dark:text-gray-600 fill-white" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor"/><path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill"/></svg>
                  <span className="sr-only">Loading...</span>
              </div>
          </div>
          :
          null
        } */}
				{loading ? (
					<>
						{pantsCase && (
							<div className="vp-loadinfo">
								<div className="w-fit">
									<SnakeGame />
								</div>
								{(dlDone || dlPct != null) && (
									<div className="vp-progress">
										<div className="vp-progress__head">
											<span className="vp-progress__label">
												{dlDone ? "Finalizing…" : "Loading scan"}
											</span>
											{!dlDone && dlPct != null && (
												<span className="vp-progress__pct">{dlPct}%</span>
											)}
										</div>
										<div className="vp-progress__track">
											<div
												className={`vp-progress__fill ${dlDone ? "is-finalizing" : ""}`}
												style={dlDone ? undefined : { width: `${dlPct ?? 0}%` }}
											/>
										</div>
									</div>
								)}
							</div>
						)}
						{/* 3D organ loader; falls back to a lightweight spinner if it can't
						    render (lazy chunk error / WebGL context unavailable). */}
						<ErrorBoundary
							fallback={
								<div className="vp-loading">
									<div className="flex flex-col items-center gap-4">
										<div className="vp-spinner" />
										<div className="vp-loading__text">Preparing case {displayId}…</div>
									</div>
								</div>
							}
						>
							<Suspense
								fallback={
									<div className="vp-loading">
										<div className="vp-spinner" />
									</div>
								}
							>
								<RotatingModelLoader />
							</Suspense>
						</ErrorBoundary>
					</>
				) : null}
				<div
					className="visualization-container"
					ref={VisualizationContainer_ref}
					style={{
						overflow: "hidden",
						// Collapse to a single cell only for the 2D single views. MPR and 3D keep
						// the 2×2 grid (3D just overlays the render pane on top of it).
						...(viewMode !== "mpr" && viewMode !== "3d"
							? { gridTemplateColumns: "1fr", gridTemplateRows: "1fr" }
							: {}),
					}}
				>
					<div
						className={`axial ${loading ? "" : "vp-pane vp-pane--axial"}`}
						data-label="Axial"
						ref={axial_ref}
						style={panelStyle("axial")}
						onClick={(e) => { handleMouseClick(e); }}
					></div>
					<div
						className={`sagittal ${loading ? "" : "vp-pane vp-pane--sagittal"}`}
						data-label="Sagittal"
						ref={sagittal_ref}
						style={panelStyle("sagittal")}
						onClick={(e) => { handleMouseClick(e); }}
					></div>

					<div
						className={`coronal ${loading ? "" : "vp-pane vp-pane--coronal"}`}
						data-label="Coronal"
						ref={coronal_ref}
						style={panelStyle("coronal")}
						onClick={(e) => { handleMouseClick(e); }}
					></div>

					<div className={`render ${loading ? "" : "vp-pane vp-pane--render"}`} data-label="3D" style={panelStyle("3d")}>
						<div className="canvas">
							<canvas
								ref={render_ref}
							// width={800} 
							// height={800} 
							// style={{ width: "100%", height: "100%" }}
							>
							</canvas>
							{tooltip.visible && (
								<div
									className="vp-organ-tip"
									style={{ top: tooltip.y, left: tooltip.x }}
								>
									{tooltip.text}
								</div>
							)}
						</div>
					</div>
				</div>
			</div>

			{/* Fixed bottom bar for organ selection */}

			<OrganCheckbox
				setCheckState={setCheckState}
				checkState={checkState}
				sessionId={sessionKey}
				setShowTaskDetails={setShowTaskDetails}
				setShowOrganDetails={setShowOrganDetails}
				showOrganDetails={showOrganDetails}
				labelColorMap={labelColorMap}
				onJumpToOrgan={handleJumpToOrgan}
			/>

			{showStats && (
				<div className="vp-stats">
					<div className="vp-stats__head">
						<span className="vp-panel__title">Organ Statistics</span>
						<button
							className="vp-stats__close"
							onClick={() => setShowStats(false)}
							aria-label="Close organ statistics"
						>
							×
						</button>
					</div>
					{statsLoading ? (
						<div className="vp-stats__msg">Computing…</div>
					) : statsError ? (
						<div className="vp-stats__msg">
							Organ statistics aren't available for this case here.
							<br />
							<span style={{ opacity: 0.7 }}>
								(They're computed from the dataset volumes on the server.)
							</span>
						</div>
					) : organStats && organStats.length > 0 ? (
						<div className="vp-stats__table">
							<div className="vp-stats__row vp-stats__row--head">
								<span>Organ</span>
								<span>Volume</span>
								<span>Mean HU</span>
							</div>
							{organStats.map((o, i) => {
								const badVol = o.volume_cm3 === 999999;
								const badHu = o.mean_hu === 999999;
								return (
									<div className="vp-stats__row" key={`${o.organ_name}-${i}`}>
										<span>{filenameToName(o.organ_name)}</span>
										<span>{badVol ? "NA" : `${Math.round(o.volume_cm3)} cm³`}</span>
										<span>{badHu ? "NA" : Math.round(o.mean_hu)}</span>
									</div>
								);
							})}
						</div>
					) : (
						<div className="vp-stats__msg">No organ data available.</div>
					)}
				</div>
			)}

			{
				showReportScreen && (
					<ReportScreen
						id={displayId}
						onClose={() => setShowReportScreen(false)}
					/>
				)
			}
		</div >
	);
}

export default VisualizationPage;
