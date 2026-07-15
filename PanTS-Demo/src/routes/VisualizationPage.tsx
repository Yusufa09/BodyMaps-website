import type { RenderingEngine } from "@cornerstonejs/core";
import type { Color, ColorLUT } from "@cornerstonejs/core/types";
import type { vtkVolumeProperty } from '@kitware/vtk.js/Rendering/Core/VolumeProperty';
import { Niivue } from "@niivue/niivue";
import {
    IconAdjustmentsHorizontal,
    IconAngle,
    IconArrowBackUp,
    IconArrowForwardUp,
    IconArrowsCross,
    IconArrowUpRight,
    IconBrush,
    IconCamera,
    IconChartBar,
    IconCheck,
    IconChevronDown,
    IconCircle,
    IconClick,
    IconDownload,
    IconEye,
    IconFlipHorizontal,
    IconGrid3x3,
    IconHome,
    IconId,
    IconLasso,
    IconLayoutSidebarRight,
    IconListDetails, IconMicrophone, IconPlayerPause, IconPlayerPlay, IconPointer, IconReport,
    IconRotateClockwise,
    IconRuler2,
    IconScanEye,
    IconSettings,
    IconShare,
    IconSquareDashed,
    IconStack2,
    IconTrash,
    IconZoomIn
} from "@tabler/icons-react";
import React, { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useLocation, useParams } from "react-router-dom";
import AISidebar from "../components/AIAssistant/AISidebar";
import { buildViewerActions } from "../components/AIAssistant/assistantActions";
import MaskEditPanel, { type MaskEditMode } from "../components/MaskEditPanel/MaskEditPanel";
import MeasurementPanel from "../components/MeasurementPanel/MeasurementPanel";
import { SegmentationMeshViewer } from "../components/MeshViewer";
import OrganCheckbox from "../components/OrganCheckbox";
import PercentileBar from "../components/PercentileBar";
import SessionHUD from "../components/ReadingSession/SessionHUD";
import SessionSummary from "../components/ReadingSession/SessionSummary";
import ReportScreen from "../components/ReportScreen/ReportScreen";
import {
    API_BASE,
    APP_CONSTANTS,
    segmentation_categories,
    segmentation_category_colors,
} from "../helpers/constants";
import {
    ANGLE_TOOL,
    applyVolume3DPreset,
    ARROW_TOOL,
    BIDIRECTIONAL_TOOL,
    captureViewportImages,
    centerOnCursor,
    clearMeasurements,
    createNewAnnotationClass,
    disableVolume3D,
    EDIT_BRUSH,
    EDIT_ERASER,
    ELLIPSE_TOOL,
    enableVolume3D,
    flipPaneHorizontal,
    FREEHAND_ROI_TOOL,
    getCrosshairMm,
    getCurrentVolumeModality,
    getMeasurementSummaries,
    getOrganCentroids,
    getOrganLabelAtPoint,
    getOrganLabelOnClick,
    LENGTH_TOOL,
    MAGNIFY_TOOL,
    moveCornerstoneCrosshairToMm,
    PROBE_TOOL,
    redoMaskEdit,
    renderVisualization,
    resetMprOrientation,
    ROI_TOOL,
    rotatePane90Clockwise,
    setActiveMaskEditTool,
    setActiveMeasurementTool,
    setFillOpacity,
    setOutlineOpacity,
    setPaneSliceIndex,
    setReferenceLinesEnabled,
    setVisibilities,
    setZoom,
    startCine,
    stopCine,
    subscribeToCrosshairChanges,
    subscribeToMeasurementChanges,
    subscribeToSliceChanges,
    subscribeToVolumeProgress,
    toggleCrosshairTool,
    undoMaskEdit,
    upgradeCtVolume,
    VOLUME_3D_PRESETS,
    VOLUME_3D_PRESETS_MR,
    zoomToFit,
	getCustomSegmentLabels,
    type CinePane,
    type PrimaryMouseToolName,
    type SliceInfo
} from "../helpers/CornerstoneNifti2";
import { getLocalDicomFiles, loadLocalDicomSeries } from "../helpers/dicomLocal";
import { downloadUrlAsFile } from "../helpers/downloadFile";
import {
    describeBasis,
    loadOrganNorms,
    type OrganNorms,
} from "../helpers/organNorms";
import {
    computeStatRows,
    downloadStats,
    summarizeOutOfRange,
    type OrganMetric,
} from "../helpers/organStatsExport";
import {
    composeImagesSideBySide,
    ReadingSession,
    type SessionResult,
} from "../helpers/readingSession";
import { toolDisplayName, type ReportMeasurement } from "../helpers/sessionReport";
import { filenameToName, getPanTSId } from "../helpers/utils";
import { decodeViewerState, encodeViewerState } from "../helpers/viewerShareState";
import { type CheckBoxData } from "../types";
import "./VisualizationPage.css";

type ViewMode = "mpr" | "axial" | "sagittal" | "coronal" | "3d";

// OHIF-style "hanging protocol" layouts for the MPR grid: besides the equal 2×2 grid,
// one pane can be given the lion's share of the space while the other three stack down
// a narrow side column — same idea as OHIF's asymmetric layouts, just a fixed small set
// of presets rather than a free-form layout editor. Only meaningful while viewMode is
// "mpr" (the single-view and 3d-fullscreen modes already dedicate 100% to one pane).
type LayoutPreset = "grid" | "axial-primary" | "sagittal-primary" | "coronal-primary" | "3d-primary";

const LAYOUT_PRESETS: { id: LayoutPreset; label: string }[] = [
	{ id: "grid", label: "Equal" },
	{ id: "axial-primary", label: "Axial Large" },
	{ id: "sagittal-primary", label: "Sagittal Large" },
	{ id: "coronal-primary", label: "Coronal Large" },
	{ id: "3d-primary", label: "3D Large" },
];

// Which pane each non-"grid" preset enlarges. The other three fill the remaining
// narrow column, in this fixed top-to-bottom order (primary pane excluded).
const LAYOUT_PRESET_PRIMARY: Record<Exclude<LayoutPreset, "grid">, ViewMode> = {
	"axial-primary": "axial",
	"sagittal-primary": "sagittal",
	"coronal-primary": "coronal",
	"3d-primary": "3d",
};
const LAYOUT_PANE_ORDER: ViewMode[] = ["axial", "sagittal", "coronal", "3d"];

// View-mode picker + pane-layout preset picker are both "ways to view / arrange the
// scan," so they share one "Layout ▾" toolbar dropdown instead of two separate
// always-visible rows of segmented buttons.
const VIEW_MODE_OPTIONS: { mode: ViewMode; label: string }[] = [
	{ mode: "mpr", label: "⊞ MPR" },
	{ mode: "axial", label: "Axial" },
	{ mode: "sagittal", label: "Sag" },
	{ mode: "coronal", label: "Cor" },
	{ mode: "3d", label: "3D" },
];
const VIEW_MODE_SHORT_LABEL: Record<ViewMode, string> = {
	mpr: "MPR",
	axial: "Axial",
	sagittal: "Sagittal",
	coronal: "Coronal",
	"3d": "3D",
};

// Case metadata fields pulled from PanTS/metadata.xlsx (via /api/search), in display
// order — a curated subset of row_to_item's fields; spacing_sum/shape_sum/complete are
// internal sort helpers, not meaningful to show a reader.
const METADATA_FIELDS: { key: string; label: string }[] = [
	{ key: "PanTS ID", label: "PanTS ID" },
	{ key: "sex", label: "Sex" },
	{ key: "age", label: "Age" },
	{ key: "tumor", label: "Tumor" },
	{ key: "ct phase", label: "CT Phase" },
	{ key: "manufacturer", label: "Manufacturer" },
	{ key: "manufacturer model", label: "Scanner Model" },
	{ key: "study year", label: "Study Year" },
	{ key: "study type", label: "Study Type" },
	{ key: "site nationality", label: "Site" },
];

const formatMetaValue = (key: string, v: unknown): string => {
	if (key === "tumor") {
		if (v === 1 || v === true) return "Yes";
		if (v === 0 || v === false) return "No";
		return "Unknown";
	}
	if (v === null || v === undefined || v === "") return "—";
	if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(1);
	return String(v);
};

type OrganStat = OrganMetric;

// Formats a nullable metric for the organ-stats detail drawer — "—" when the backend
// didn't compute it (e.g. an empty/degenerate mask), fixed-point otherwise.
const fmtStat = (v: number | null, digits = 0): string => (v === null ? "—" : v.toFixed(digits));

// Cornerstone's segmentation Color is [r, g, b, a] on a 0–255 scale; CSS wants alpha 0–1.
// Falls back to a neutral gray if a label has no LUT entry (shouldn't happen in practice).
const colorToCss = (c: Color | undefined): string =>
	c ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${(c[3] ?? 255) / 255})` : "rgba(255, 255, 255, 0.4)";

// Resolves a segment index to a display name for BOTH the static 32 organ
// catalog and any runtime-created custom classes (segment indices beyond
// segmentation_categories.length, eg., from "New class" in annotations tool).

const resolveOrganLabel = (idx: number): string | undefined => {
    const staticName = segmentation_categories[idx - 1];
    if (staticName) return filenameToName(staticName);
    return getCustomSegmentLabels()[idx];
};

const CT_PRESETS = [
	{ name: "Soft Tissue", width: 400, center: 40 },
	{ name: "Bone", width: 1800, center: 400 },
	{ name: "Lung", width: 1500, center: -600 },
	{ name: "Liver", width: 150, center: -50 }, // Brightness 50 (= -center), Contrast 150 (= width)
	{ name: "Brain", width: 80, center: 40 },
	{ name: "Angio", width: 600, center: 150 }, // contrast-enhanced vessels (CTA)
] as const;

// Measurement tools (+ the magnify loupe, which shares the same primary-mouse-tool slot)
// shown inside the collapsible "Measure" flyout, so the toolbar isn't crowded with one
// button per tool (matches the split-button pattern OHIF uses). `key` is the keyboard
// shortcut (also shown in the flyout). Typed by PrimaryMouseToolName (not the narrower
// MeasurementToolName) so the magnify entry — a plain `string`, deliberately not part of
// the measurement-tool union — fits in the same array.
const MEASURE_TOOLS: { name: PrimaryMouseToolName; label: string; Icon: typeof IconRuler2; key: string }[] = [
	{ name: LENGTH_TOOL, label: "Distance (mm)", Icon: IconRuler2, key: "L" },
	{ name: BIDIRECTIONAL_TOOL, label: "Bidirectional · long × short axis", Icon: IconArrowsCross, key: "B" },
	{ name: ANGLE_TOOL, label: "Angle (°)", Icon: IconAngle, key: "A" },
	{ name: PROBE_TOOL, label: "HU at point", Icon: IconClick, key: "P" },
	{ name: ROI_TOOL, label: "Rect ROI · HU & area", Icon: IconSquareDashed, key: "R" },
	{ name: ELLIPSE_TOOL, label: "Ellipse ROI · HU & area", Icon: IconCircle, key: "E" },
	{ name: FREEHAND_ROI_TOOL, label: "Freehand ROI · HU & area", Icon: IconLasso, key: "F" },
	{ name: ARROW_TOOL, label: "Arrow · label a finding", Icon: IconArrowUpRight, key: "T" },
	{ name: MAGNIFY_TOOL, label: "Magnify loupe", Icon: IconZoomIn, key: "G" },
];

// One flyout group's transient UI state: whether it's open, where its portal-rendered
// panel sits (measured off the trigger button on open), and the refs the outside-
// click/reflow handler needs. Used for every toolbar dropdown (Measure, View, Cine,
// Edit, Capture, Panels, Report) so that logic — open/close, position, dismiss-on-
// outside-click-or-scroll — isn't hand-duplicated per group.
function useToolbarFlyout() {
	const [open, setOpen] = useState(false);
	const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
	const groupRef = useRef<HTMLDivElement>(null);
	const btnRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	const toggle = () => {
		setOpen((prev) => {
			const next = !prev;
			if (next && btnRef.current) {
				const r = btnRef.current.getBoundingClientRect();
				setPos({ top: r.bottom + 8, left: r.left });
			}
			return next;
		});
	};
	const close = () => setOpen(false);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: globalThis.MouseEvent) => {
			const t = e.target as Node;
			if (groupRef.current?.contains(t) || menuRef.current?.contains(t)) return;
			setOpen(false);
		};
		const onReflow = () => setOpen(false);
		document.addEventListener("mousedown", onPointerDown);
		window.addEventListener("scroll", onReflow, true);
		window.addEventListener("resize", onReflow);
		return () => {
			document.removeEventListener("mousedown", onPointerDown);
			window.removeEventListener("scroll", onReflow, true);
			window.removeEventListener("resize", onReflow);
		};
	}, [open]);

	return { open, pos, groupRef, btnRef, menuRef, toggle, close };
}

function VisualizationPage() {
	// References and state
	const params = useParams();
	const pantsCase = params.caseId;
	const sessionId = params.sessionId;
	// Local DICOM mode (/dicom): a folder of .dcm files picked on the Upload page,
	// viewed entirely in-browser. No backend case, so no segmentation layer.
	const routerLocation = useLocation();
	const isDicom = routerLocation.pathname === "/dicom";
	const [dicomError, setDicomError] = useState<string | null>(null);

	// Where to load the volumes from. Per the maintainer's rule, dataset cases load
	// from the lab's LOCAL endpoints (served off disk on the JHU server — much faster
	// for big full-body scans than streaming the .nii.gz from HuggingFace). We probe
	// the local file and only fall back to the public HuggingFace mirror when it isn't
	// present (e.g. a dev checkout without the image data), so the viewer never breaks.
	const caseId = isDicom ? "Local DICOM" : pantsCase ?? sessionId ?? "1";
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
			if (isDicom) return; // local files, not URLs — the setup effect handles them
			if (sessionId) {
				setCtUrl(`${API_BASE}/api/session-ct/${sessionId}`);
				setSegUrl(`${API_BASE}/api/session-segmentation/${sessionId}`);
				return;
			}
			const id = pantsCase ?? "1";
			const p = getPanTSId(id);
			const localCt = `${API_BASE}/api/get-main-nifti/${id}.nii.gz`;
			const localSeg = `${API_BASE}/api/get-segmentations/${id}.nii.gz`;
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
	}, [pantsCase, sessionId, isHd, isDicom]);

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
	// render_ref (3D NiiVue canvas) removed — the 3D view it fed is disabled;
	// restore this ref alongside the commented-out create3DVolume calls if re-enabled.
	// const _cmapRef = useRef<NColorMap>(null);
	// const TaskMenu_ref = useRef(null);
	const VisualizationContainer_ref = useRef(null);
	//   const lastClickInfoRef = useRef(null);
	const preIsolateCheckStateRef = useRef<boolean[] | null>(null);
	//const [isolatedOrgan, setIsolatedOrgan] = useState<string | null>(null);

	const [checkState, setCheckState] = useState<boolean[]>([true]);
	const [NV, _setNV] = useState<Niivue | undefined>();
	const [checkBoxData, setCheckBoxData] = useState<CheckBoxData[]>([]);
	// Fill (solid color wash) and outline (border) opacity are independent sliders — see
	// setFillOpacity/setOutlineOpacity. Outline defaults to 0 (off), matching how the mask
	// looked before this split existed (borders were never actually rendered).
	const [opacityValue, setOpacityValue] = useState(
		APP_CONSTANTS.DEFAULT_SEGMENTATION_OPACITY * 100
	);
	const [outlineOpacityValue, setOutlineOpacityValue] = useState(0);
	// Current/total slice per MPR pane, for the "245/519" caption + drag scrollbar.
	// Populated by subscribeToSliceChanges once the volume is ready; null until then.
	const [sliceInfo, setSliceInfo] = useState<Record<CinePane, SliceInfo | null>>({
		axial: null,
		sagittal: null,
		coronal: null,
	});
	// Matches the "Soft Tissue" CT_PRESETS entry (W 400 / L 40) — activePreset below
	// defaults to that same preset, so the readout and the pre-highlighted button
	// should agree on first load instead of showing a level the preset never set.
	const [windowWidth, setWindowWidth] = useState(400);
	const [windowCenter, setWindowCenter] = useState(40);
	// Brief W/L readout: shown only while the user is actively dragging the brightness/
	// contrast sliders or picking a preset — not on the initial/deep-link window apply, and
	// not left on screen indefinitely. windowReadoutTimerRef holds the fade-out timeout so
	// each new change can restart it instead of stacking timers.
	const [windowReadoutVisible, setWindowReadoutVisible] = useState(false);
	const windowReadoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [renderingEngine, setRenderingEngine] =
		useState<RenderingEngine | null>(null);
	const [viewportIds, setViewportIds] = useState<string[]>([]);
	const [volumeId, setVolumeId] = useState<string | null>(null);
	const [showReportScreen, setShowReportScreen] = useState(false);
	const [showStats, setShowStats] = useState(false);
	const [showAISidebar, setShowAISidebar] = useState(false);
	const [organStats, setOrganStats] = useState<OrganStat[] | null>(null);
	const [statsLoading, setStatsLoading] = useState(false);
	const [statsError, setStatsError] = useState(false);
	// Row index of the organ whose full metric breakdown (median/std dev/skew/kurtosis/...)
	// is expanded inline. Only one at a time — keeps the panel compact by default.
	const [expandedStatRow, setExpandedStatRow] = useState<number | null>(null);
	// Population reference + this case's demographics, used to show each organ's volume
	// percentile vs the dataset. Both are optional — if the norms asset is missing (e.g. a
	// dev checkout) or the case has no metadata, the panel just omits the percentile column.
	const [organNorms, setOrganNorms] = useState<OrganNorms | null>(null);
	const [demographics, setDemographics] = useState<{ sex: string | null; age: number | null } | null>(null);
	const normsTried = useRef(false);
	// Case metadata panel (PanTS/metadata.xlsx, via the same /api/search lookup that
	// already supplies demographics). demographicsTriedRef guards the fetch so it only
	// ever runs once per case, even if no matching row is found (in which case
	// caseMetadata stays null and the panel shows its "not available" state).
	const [showMetadata, setShowMetadata] = useState(false);
	const [caseMetadata, setCaseMetadata] = useState<Record<string, unknown> | null>(null);
	const demographicsTriedRef = useRef(false);
	// Measured download progress for the loading screen (from the nifti loader's real
	// bytes-loaded/total — accurate, not a guess).
	const [dlPct, setDlPct] = useState<number | null>(null);
	const [dlDone, setDlDone] = useState(false);
	const dlTotalsRef = useRef<Record<string, number>>({});
	// The tools live in a top toolbar (PYCAD-style) that sits above the viewports in
	// normal flow; the gear button shows/hides it. Hidden by default — a single
	// floating gear reveals it — so the viewer opens clean/full-bleed.
	const [showToolbar, setShowToolbar] = useState(false);
	const topbarRef = useRef<HTMLDivElement>(null);
	const stageRef = useRef<HTMLDivElement>(null);
	const [showOrganDetails, setShowOrganDetails] = useState(false);
	const [loading, setLoading] = useState(true);
	const [crosshairMm, setCrosshairMm] = useState<[number, number, number] | null>(null);
	const [labelColorMap, setLabelColorMap] = useState<{ [key: number]: Color }>(
		segmentation_category_colors
	);
	const [zoomLevel, setZoomLevel] = useState(1);
	const [crosshairToolActive, setCrosshairToolActive] = useState(true);
	// OHIF-style reference lines: unlike the crosshair's own intersection lines (which only
	// show while Crosshairs is the active navigation tool), this is a passive overlay that
	// keeps showing where the pane being scrolled cuts the other two, regardless of which
	// tool currently owns the mouse. Only one pane is ever the "source" at a time — a plain
	// toggle for on/off. The imperative apply happens in the effect below, which also
	// re-applies after any volume reload (a fresh tool group always starts with every tool
	// disabled).
	const [referenceLinesOn, setReferenceLinesOn] = useState(false);
	// The pane the user most recently scrolled or clicked into — "whichever axis is in
	// focus" for every single-pane tool (reference lines' source, cine, flip, rotate). A
	// ref, not state: a wheel tick shouldn't force a re-render, and reading .current at
	// call time is always fresh regardless of when the enclosing closure was created.
	const activePaneRef = useRef<CinePane>("axial");
	// Which measurement tool (or the magnify loupe) owns the primary mouse button
	// (null = navigation/crosshair).
	const [activeMeasureTool, setActiveMeasureTool] = useState<PrimaryMouseToolName | null>(null);
	// Cine playback: auto-scroll the current pane through its slices. The FPS slider is
	// always visible next to the play button (not just once playing) so the speed can be
	// dialed in before hitting play; changing it while already playing restarts the clip
	// at the new rate instead of waiting for a stop/start.
	const [cinePlaying, setCinePlaying] = useState(false);
	const [cineFps, setCineFps] = useState(12);
	// Mask editing: right-side panel + which brush (paint/erase) owns the mouse.
	const [showEditPanel, setShowEditPanel] = useState(false);
	const [editMode, setEditMode] = useState<MaskEditMode>(null);
	// Progressive resolution: after the fast low-res load, the full-res CT streams in
	// the background and hot-swaps in place (no reload). idle → streaming → done/failed.
	const [enhance, setEnhance] = useState<{ state: "idle" | "streaming" | "done" | "failed"; pct: number | null }>({ state: "idle", pct: null });
	const enhanceStartedRef = useRef(false);
	// Live mirrors so the async swap re-applies the *current* window/visibility, not
	// the values captured when the stream started.
	const windowRef = useRef({ w: windowWidth, c: windowCenter });
	const checkStateRef = useRef(checkState);
	const checkBoxDataRef = useRef(checkBoxData);
	useEffect(() => { windowRef.current = { w: windowWidth, c: windowCenter }; }, [windowWidth, windowCenter]);
	useEffect(() => { checkStateRef.current = checkState; }, [checkState]);
	useEffect(() => { checkBoxDataRef.current = checkBoxData; }, [checkBoxData]);
	// 3D pane rendering mode: organ meshes (dataset cases) or shaded GPU volume
	// rendering of the CT itself (the only 3D option for local DICOM).
	const [threeDMode, setThreeDMode] = useState<"mesh" | "volume">(isDicom ? "volume" : "mesh");
	const [volumePreset, setVolumePreset] = useState<string>(VOLUME_3D_PRESETS[0].name);
	// CT presets by default; swapped for the MR set when a local DICOM turns out to be MR.
	const [volume3DPresets, setVolume3DPresets] = useState<readonly { name: string; label: string }[]>(VOLUME_3D_PRESETS);
	const [volume3DFailed, setVolume3DFailed] = useState(false);
	const volume3DRef = useRef<HTMLDivElement>(null);
	// Toolbar flyout groups — each declutters a cluster of related buttons behind one
	// icon + dropdown (same portal-at-fixed-position pattern, so none of them get
	// clipped by the scrollable toolbar). See useToolbarFlyout.
	const layoutFlyout = useToolbarFlyout(); // view mode + pane layout preset (stays open — a config panel)
	const windowFlyout = useToolbarFlyout(); // CT window presets (stays open — a config panel)
	const adjustFlyout = useToolbarFlyout(); // fill/border/brightness/contrast/zoom sliders + center/reset (stays open)
	const measureFlyout = useToolbarFlyout(); // measurement tools + magnify loupe
	const viewFlyout = useToolbarFlyout(); // hover-identify, reference lines, flip, rotate
	const cineFlyout = useToolbarFlyout(); // play/pause + FPS (stays open — a live mini-panel, not a pick-and-dismiss menu)
	const captureFlyout = useToolbarFlyout(); // snapshot, reading session, share link
	const panelsFlyout = useToolbarFlyout(); // organs, organ stats, case metadata, measurements list

	// Reading session (voice-assisted case review). The ref mirrors the state so event
	// handlers and Cornerstone subscriptions can log without re-subscribing on start/stop.
	const sessionRef = useRef<ReadingSession | null>(null);
	const [readingSession, setReadingSession] = useState<ReadingSession | null>(null);
	const [sessionStarting, setSessionStarting] = useState(false);
	const [sessionResult, setSessionResult] = useState<SessionResult | null>(null);
	const [sessionMeasurements, setSessionMeasurements] = useState<ReportMeasurement[]>([]);
	const [showMeasurePanel, setShowMeasurePanel] = useState(false);
	// Shareable-link state: brief "copied" confirmation, and a guard so a deep-link's view
	// state is applied exactly once after the volume finishes loading.
	const [shareCopied, setShareCopied] = useState(false);
	const shareStateAppliedRef = useRef(false);
	const [viewMode, setViewMode] = useState<ViewMode>("mpr");
	// Which pane gets the lion's share of the grid while in "mpr" view — no-op in the
	// single-view / 3d-fullscreen modes, which already give one pane 100% of the stage.
	const [layoutPreset, setLayoutPreset] = useState<LayoutPreset>("grid");
	const [activePreset, setActivePreset] = useState<string>("Soft Tissue");
	const [_tooltip, setToolTip] = useState({
		visible: false,
		x: 0,
		y: 0,
		text: "",
	});

	const [hoverIdentifyEnabled, setHoverIdentifyEnabled] = useState(false);
	const [hoverOrganTip, setHoverOrganTip] = useState({
		visible: false,
		x: 0,
		y: 0,
		text: "",
		color: "transparent",
	});

	// const location = useLocation();
	// Load and render visualization on first render

	// Single owner for the primary mouse button, by priority:
	// mask editing > measurement tool > navigation (crosshair/pan).
	useEffect(() => {
		if (editMode) {
			setActiveMeasurementTool(null);
			setActiveMaskEditTool(editMode === "brush" ? EDIT_BRUSH : EDIT_ERASER);
		} else if (activeMeasureTool) {
			setActiveMaskEditTool(null);
			setActiveMeasurementTool(activeMeasureTool);
		} else {
			setActiveMaskEditTool(null);
			setActiveMeasurementTool(null);
			toggleCrosshairTool(crosshairToolActive);
		}
	}, [editMode, activeMeasureTool, crosshairToolActive]);

	useEffect(() => {
		const unsubscribe = subscribeToCrosshairChanges((mm) => {
			setCrosshairMm([
				mm[0],
				mm[1],
				mm[2],
			]);
			// Coalesced: a scroll through 40 slices reads as one "navigated to…" line.
			sessionRef.current?.log(
				"navigate",
				`Navigated to (${mm.slice(0, 3).map((v) => v.toFixed(0)).join(", ")}) mm`,
				1500
			);
		});

		return unsubscribe;
	}, [])

	// ---- Reading session: capture, key images, lifecycle ------------------------------

	// Capture the visible panes (with annotations). During a session the shot joins the
	// session's key images; outside one it downloads as a single side-by-side PNG.
	const takeSnapshot = useCallback(async (label?: string) => {
		const images = await captureViewportImages();
		if (!images.length) return;
		const session = sessionRef.current;
		if (session) {
			session.addShot(label ?? "Key image", images);
			session.log("screenshot", label ?? `Key image (${images.map((im) => im.name).join(", ")})`);
		} else {
			const composite = await composeImagesSideBySide(images);
			if (!composite) return;
			const link = document.createElement("a");
			link.href = composite;
			link.download = `case${caseId}_snapshot.png`;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
		}
	}, [caseId]);

	const startReadingSession = async () => {
		if (sessionRef.current || sessionStarting) return;
		setSessionStarting(true);
		try {
			const session = await ReadingSession.start(String(caseId));
			sessionRef.current = session;
			setReadingSession(session);
			session.log(
				"session",
				session.micGranted
					? "Reading session started — narration recording"
					: "Reading session started — no microphone, events only"
			);
		} finally {
			setSessionStarting(false);
		}
	};

	const stopReadingSession = async () => {
		const session = sessionRef.current;
		if (!session) return;
		sessionRef.current = null;
		setReadingSession(null);
		// Snapshot the measurement inventory at stop time — it feeds the draft report.
		const measurements = getMeasurementSummaries().map((m) => ({
			tool: m.tool,
			label: m.label,
			value: m.value,
		}));
		const result = await session.stop();
		setSessionMeasurements(measurements);
		setSessionResult(result);
	};

	// If the user navigates away mid-session, release the microphone.
	useEffect(() => {
		return () => {
			void sessionRef.current?.stop();
			sessionRef.current = null;
		};
	}, []);

	// Completed measurements land in the session timeline and auto-capture a key image
	// (on the next frame, after the annotation has painted onto the SVG overlay).
	useEffect(() => {
		const unsubscribe = subscribeToMeasurementChanges((kind, m) => {
			if (!sessionRef.current) return;
			if (kind === "completed") {
				sessionRef.current.log("measure", `${toolDisplayName(m.tool)} measured: ${m.value}`);
				requestAnimationFrame(() => {
					void takeSnapshot(`${toolDisplayName(m.tool)} — ${m.value}`);
				});
			} else if (kind === "removed") {
				sessionRef.current.log("measure", `Removed a ${toolDisplayName(m.tool)} measurement`);
			}
		});
		return unsubscribe;
	}, [takeSnapshot]);

	// ---- Cine playback / flip / rotate — all act on the "focused" pane -------------

	// The fullscreen 2D pane when in a single view (unambiguous — only one is on
	// screen), else whichever of the three MPR panes was most recently scrolled/clicked
	// (activePaneRef), defaulting to axial until the user interacts with a pane at all.
	// Recomputed fresh on every call — cheap, and guarantees flip/rotate (single-click
	// actions with no intervening re-render) never act on a stale pane.
	const getFocusedPane = (): CinePane =>
		viewMode === "axial" || viewMode === "sagittal" || viewMode === "coronal"
			? viewMode
			: activePaneRef.current;
	const cinePane: CinePane = getFocusedPane();

	const handleFlipHorizontal = () => {
		const pane = getFocusedPane();
		flipPaneHorizontal(pane);
		sessionRef.current?.log("view", `Flipped ${pane} horizontally`);
	};

	const handleRotate90Clockwise = () => {
		const pane = getFocusedPane();
		rotatePane90Clockwise(pane);
		sessionRef.current?.log("view", `Rotated ${pane} 90° clockwise`);
	};

	// Reads cinePlaying directly rather than through setState's functional-updater form —
	// React StrictMode double-invokes that form in dev to catch impure updaters, which would
	// call startCine/stopCine twice per click (this app runs in StrictMode; see the similar
	// double-run workarounds in dicomLocal.ts).
	const toggleCine = useCallback(() => {
		if (cinePlaying) {
			stopCine();
			setCinePlaying(false);
			sessionRef.current?.log("view", "Stopped cine playback");
			return;
		}
		const ok = startCine(cinePane, cineFps);
		setCinePlaying(ok);
		if (ok) {
			sessionRef.current?.log("view", `Started cine playback (${cinePane}, ${cineFps} fps)`);
		} else {
			console.warn(`Cine playback failed to start for pane "${cinePane}"`);
		}
	}, [cinePlaying, cinePane, cineFps]);

	// Live-adjust the frame rate: if a clip is already running, restart it immediately at
	// the new speed rather than waiting for the next stop/start.
	const handleCineFpsChange = (fps: number) => {
		setCineFps(fps);
		if (cinePlaying) {
			stopCine();
			startCine(cinePane, fps);
		}
	};

	// Changing the layout invalidates the playing pane; stop rather than guess. Also
	// stop on unmount so the interval doesn't outlive the viewports.
	useEffect(() => {
		stopCine();
		setCinePlaying(false);
	}, [viewMode]);
	useEffect(() => () => stopCine(), []);
	useEffect(() => () => {
		if (windowReadoutTimerRef.current) clearTimeout(windowReadoutTimerRef.current);
	}, []);

	// Keyboard shortcuts (skipped while typing): L/B/A/P/R/E/T measurement tools,
	// G magnify, C crosshair, S snapshot, M measurements panel, V cine,
	// Cmd/Ctrl+Z undo · Shift+Cmd/Ctrl+Z redo (strokes AND measurements).
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
			)
				return;
			const key = e.key.toLowerCase();
			if ((e.metaKey || e.ctrlKey) && !e.altKey && key === "z") {
				if (e.shiftKey) redoMaskEdit();
				else undoMaskEdit();
				e.preventDefault();
				return;
			}
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			const toolByKey: Record<string, PrimaryMouseToolName> = {
				l: LENGTH_TOOL,
				b: BIDIRECTIONAL_TOOL,
				a: ANGLE_TOOL,
				p: PROBE_TOOL,
				r: ROI_TOOL,
				e: ELLIPSE_TOOL,
				f: FREEHAND_ROI_TOOL,
				t: ARROW_TOOL,
				g: MAGNIFY_TOOL,
			};
			if (toolByKey[key]) {
				setEditMode(null); // measurement keys take the mouse back from the brush
				setActiveMeasureTool((prev) => (prev === toolByKey[key] ? null : toolByKey[key]));
			} else if (key === "c") {
				setEditMode(null);
				setActiveMeasureTool(null);
				setCrosshairToolActive(true);
			} else if (key === "s") {
				void takeSnapshot();
			} else if (key === "v") {
				toggleCine();
			} else if (key === "m") {
				setShowStats(false);
				setShowMetadata(false);
				setShowEditPanel(false);
				setEditMode(null);
				setShowMeasurePanel((v) => !v);
			} else {
				return;
			}
			e.preventDefault();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [takeSnapshot, toggleCine]);

	// View-mode changes belong in the reading timeline (skip the initial mount).
	const loggedViewMode = useRef<ViewMode | null>(null);
	useEffect(() => {
		if (loggedViewMode.current !== null && loggedViewMode.current !== viewMode) {
			sessionRef.current?.log(
				"view",
				`Switched to ${viewMode === "mpr" ? "MPR" : viewMode === "3d" ? "3D" : viewMode} view`
			);
		}
		loggedViewMode.current = viewMode;
	}, [viewMode]);

	// ---- Progressive resolution: background full-res stream + in-place swap --------

	const runEnhance = async () => {
		if (!pantsCase || enhanceStartedRef.current) return;
		enhanceStartedRef.current = true;
		setEnhance({ state: "streaming", pct: 0 });
		// The HD stream is the only download in flight, so any progress event is ours.
		const unsubscribe = subscribeToVolumeProgress((loaded, total) => {
			if (total > 0) {
				setEnhance({ state: "streaming", pct: Math.min(100, Math.round((loaded / total) * 100)) });
			}
		});
		try {
			const newVolumeId = await upgradeCtVolume(`${API_BASE}/api/get-main-nifti/${pantsCase}.nii.gz`);
			if (!newVolumeId) {
				setEnhance({ state: "failed", pct: null });
				return;
			}
			setVolumeId(newVolumeId);
			// setVolumes resets the transfer function and rebuilds the labelmap actors —
			// re-apply the *current* window and organ visibility (live refs, not closures).
			handleWindowChange(windowRef.current.w, windowRef.current.c);
			setVisibilities([
				true,
				...checkBoxDataRef.current.map((item) => !!checkStateRef.current[item.id]),
			]);
			setEnhance({ state: "done", pct: 100 });
			sessionRef.current?.log("session", "Enhanced to full resolution");
		} catch {
			setEnhance({ state: "failed", pct: null });
		} finally {
			unsubscribe();
		}
	};

	// Auto-start the full-res stream shortly after the fast low-res view is usable.
	// Only when the local files exist (server disk — fast); the HuggingFace fallback
	// is already full-res, and ?hd=1 loads full-res up front.
	useEffect(() => {
		if (loading || !localAvailable || isHd || isDicom || !pantsCase) return;
		if (enhanceStartedRef.current) return;
		// Ref is flipped inside the timer (not here) so StrictMode's double-run —
		// which clears the first timer — still ends up scheduling exactly one stream.
		const timer = window.setTimeout(() => { void runEnhance(); }, 1500);
		return () => window.clearTimeout(timer);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [loading, localAvailable, isHd, isDicom, pantsCase]);

	// ---- Shaded 3D volume rendering (Volume mode in the 3D pane) -------------------

	useEffect(() => {
		if (loading || threeDMode !== "volume" || !renderingEngine) return;
		const element = volume3DRef.current;
		if (!element) return;
		let disposed = false;
		setVolume3DFailed(false);
		(async () => {
			const ok = await enableVolume3D(element, volumePreset).catch(() => false);
			if (!disposed && !ok) setVolume3DFailed(true);
		})();
		return () => {
			disposed = true;
			disableVolume3D();
		};
		// volumePreset intentionally omitted — preset changes are applied in place below,
		// without tearing the viewport down.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [threeDMode, loading, renderingEngine]);

	useEffect(() => {
		if (threeDMode === "volume") applyVolume3DPreset(volumePreset);
	}, [volumePreset, threeDMode]);

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
		// Guards against a stale async load winning a race: if ctUrl/segUrl change
		// mid-load (e.g. HD toggle or navigation), the first renderVisualization can
		// resolve after the second and clobber state with the wrong case's result.
		let cancelled = false;
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

			// Local DICOM: build imageIds from the picked files instead of NIfTI URLs.
			// No segmentation layer exists for these scans.
			if (isDicom) {
				if (!axial_ref.current || !sagittal_ref.current || !coronal_ref.current) return;
				const files = getLocalDicomFiles();
				if (!files.length) {
					// Deep link or reload without files in memory — go pick a folder.
					window.location.href = "/upload";
					return;
				}
				try {
					const { imageIds } = await loadLocalDicomSeries(files);
					const result = await renderVisualization(
						axial_ref.current,
						sagittal_ref.current,
						coronal_ref.current,
						cmap,
						"",
						undefined,
						setLoading,
						{ ctImageIds: imageIds }
					);
					setLoading(false);
					// Non-CT DICOM (MR/PET/…) needs its own window, not the CT presets —
					// seed the sliders from the scan's VOI so the initial-window effect
					// applies the right level instead of clipping the image flat.
					if (result.initialVoi) {
						setWindowWidth(result.initialVoi.windowWidth);
						setWindowCenter(result.initialVoi.windowCenter);
						setActivePreset("");
					}
					// Same idea for the 3D pane: CT transfer functions render MR as an
					// opaque slab, so switch the preset set to Cornerstone's MR presets.
					if (getCurrentVolumeModality() === "MR") {
						setVolume3DPresets(VOLUME_3D_PRESETS_MR);
						setVolumePreset(VOLUME_3D_PRESETS_MR[0].name);
					}
					setRenderingEngine(result.renderingEngine);
					setViewportIds(result.viewportIds);
					setVolumeId(result.volumeId);
				} catch (e) {
					console.error(e);
					setDicomError(e instanceof Error ? e.message : "Failed to load the DICOM series.");
					setLoading(false);
				}
				return;
			}

			if (
				!ctUrl ||
				!segUrl ||
				!axial_ref.current ||
				!sagittal_ref.current ||
				!coronal_ref.current ||
				// !render_ref.current ||
				cmap.length === 0
			) {
				console.log("return", ctUrl, segUrl);
				return;
			}

			const result = await renderVisualization(
				axial_ref.current,
				sagittal_ref.current,
				coronal_ref.current,
				cmap,
				ctUrl,
				segUrl,
				setLoading
			);

			if (cancelled) return; // a newer load started; drop this stale result

			setLoading(false);
			const {
				renderingEngine,
				viewportIds,
				volumeId,
			} = result;

			setRenderingEngine(renderingEngine);
			setViewportIds(viewportIds);
			setVolumeId(volumeId);

			// const { nv, cmapCopy } = await create3DVolume(
			// 	render_ref,
			// 	segUrl,
			// 	labelColorMap,
			// 	(mm) => moveCornerstoneCrosshairToMm(mm as [number, number, number])
			// );
			// cmapRef.current = cmapCopy;
			// setNV(nv);

			// // Cornerstone → NiiVue: when crosshair moves in any 2D view, sync to 3D
			// subscribeToCrosshairChanges((mm) => {
			// 	moveNiiVueCrosshairToMm(nv, mm);
			// });
		};

		setup();

		return () => {
			cancelled = true;
		};
		// refs have stable identity, so they aren't real deps; the loads key off
		// ctUrl/segUrl/labelColorMap.
	}, [
		ctUrl,
		segUrl,
		isDicom,
		axial_ref,
		sagittal_ref,
		coronal_ref,
		// labelColorMap intentionally excluded — creating a new class updates
		// this map and would otherwise retrigger the CT/volume setup effect.
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
		// Coalesced: a slider drag logs as one final "W/L" line, not dozens.
		sessionRef.current?.log("window", `Window/level set to W ${_width} / L ${_center}`, 1200);

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

	// Track each pane's current/total slice for the "245/519" caption + drag scrollbar.
	// Re-subscribes on every volume (re)load, since a fresh render tears down the old
	// viewport elements the previous subscription's listeners were attached to.
	useEffect(() => {
		if (!renderingEngine || !viewportIds.length || !volumeId) return;
		const unsubscribe = subscribeToSliceChanges((pane, info) => {
			setSliceInfo((prev) => (prev[pane]?.current === info.current && prev[pane]?.total === info.total
				? prev
				: { ...prev, [pane]: info }));
		});
		return unsubscribe;
	}, [renderingEngine, viewportIds, volumeId]);

	// Apply the reference-lines toggle once the engine/viewports/volume are ready, and
	// re-apply on both a user toggle and a volume reload (a fresh tool group always starts
	// with every tool disabled).
	useEffect(() => {
		if (renderingEngine && viewportIds.length && volumeId) {
			setReferenceLinesEnabled(referenceLinesOn, activePaneRef.current);
		}
	}, [referenceLinesOn, renderingEngine, viewportIds, volumeId]);

	// Wheel-scrolling or clicking a pane makes it "focused" — the reference-lines source,
	// and the target for cine/flip/rotate. No-ops the reference-lines re-apply while that
	// tool is off; the ref update itself is cheap enough to run unconditionally.
	// Guarded on the pane actually changing: a wheel gesture fires this once per slice
	// (dozens of times while scrolling through the SAME pane), and re-running
	// setReferenceLinesEnabled on every tick — a full disable/enable + re-render of all
	// three viewports — for a source that hasn't changed was visible as the dotted lines
	// flickering off and back on during a normal scroll.
	const handlePaneFocus = (pane: CinePane) => {
		const paneChanged = activePaneRef.current !== pane;
		activePaneRef.current = pane;
		if (referenceLinesOn && paneChanged) setReferenceLinesEnabled(true, pane);
	};
	const handlePaneWheel = (pane: CinePane) => () => handlePaneFocus(pane);
	const handlePaneMouseDown = (pane: CinePane) => () => handlePaneFocus(pane);

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
			setFillOpacity(shared.opacity / 100);
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

	// The Measure button shows the active tool's icon (including magnify, now folded into
	// the same flyout/state), or the ruler when nothing is active.
	const measureToolActive = activeMeasureTool !== null;
	const ActiveMeasureIcon = MEASURE_TOOLS.find((t) => t.name === activeMeasureTool)?.Icon ?? IconRuler2;

	// Group-level "something inside is active" flags, so each collapsed toolbar dropdown
	// still visually reflects its contents' state without having to be open.
	const viewGroupActive = hoverIdentifyEnabled || referenceLinesOn;
	const panelsGroupActive = showOrganDetails || showStats || showMetadata || showMeasurePanel;

	// The Layout ▾ trigger shows the pane-layout preset's name when one is active
	// (it's the more specific choice), otherwise the current view mode.
	const layoutTriggerLabel =
		viewMode === "mpr" && layoutPreset !== "grid"
			? LAYOUT_PRESETS.find((p) => p.id === layoutPreset)?.label ?? VIEW_MODE_SHORT_LABEL.mpr
			: VIEW_MODE_SHORT_LABEL[viewMode];

	// Center on an organ (from the sidebar): move both the 2D MPR crosshair and the 3D
	// (NiiVue) crosshair — the Cornerstone move suppresses its change event, so the 3D
	// view has to be synced explicitly — and make sure the organ is visible there.
	const handleJumpToOrgan = (label: number) => {
		const centroid = getOrganCentroids()?.[label];
		if (!centroid) return; // organ not present in this scan
		moveCornerstoneCrosshairToMm(centroid);
		setCrosshairMm(centroid);
		sessionRef.current?.log(
			"organ",
			`Jumped to ${checkBoxData.find((o) => o.id === label)?.label ?? `organ ${label}`}`
		);
		// if (NV) moveNiiVueCrosshairToMm(NV, centroid);
		setCheckState((prev) => {
			if (prev[label]) return prev;
			const next = [...prev];
			next[label] = true;
			return next;
		});
	};

	const handleOrganHighlight = useCallback((organName: string, centroidMm?: [number, number, number]) => {
		if (centroidMm) {
			moveCornerstoneCrosshairToMm(centroidMm);
			setCrosshairMm(centroidMm);
		}
		const idx = segmentation_categories.findIndex(
			(cat) => cat === organName || cat.startsWith(organName)
		);
		if (idx === -1) return;
		const labelId = idx + 1;
		setCheckState((prev) => {
			if (!preIsolateCheckStateRef.current) {
				preIsolateCheckStateRef.current = prev;
			}
			const next = prev.map(() => false);
			next[0] = true;
			next[labelId] = true;
			return next;
		});
	}, []);

	const handleClearIsolation = useCallback(() => {
		if (preIsolateCheckStateRef.current) {
			setCheckState(preIsolateCheckStateRef.current);
			preIsolateCheckStateRef.current = null;
		}
	}, []);

	const handleHideOrgans = useCallback((organNames: string[]) => {
		setCheckState(prev => {
			if (!preIsolateCheckStateRef.current) {
				preIsolateCheckStateRef.current = [...prev];
			}
			const next = [...prev];
			organNames.forEach(name => {
				const idx = segmentation_categories.findIndex(
					cat => cat === name || cat.startsWith(name)
				);
				if (idx >= 0) next[idx + 1] = false;
			});
			return next;
		});
	}, []);

	

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
	}, [viewMode, layoutPreset, showAISidebar, renderingEngine, NV, viewportIds]);

	// Apply zoom to the Cornerstone viewports whenever the toolbar slider changes.
	// (Previously ZoomHandle owned this side effect; the slider now lives in the toolbar.)
	useEffect(() => {
		if (!renderingEngine || !viewportIds.length) return;
		setZoom(zoomLevel);
	}, [zoomLevel, renderingEngine, viewportIds]);

	// Keep the WebGL viewports fitted to the stage as it resizes — when the toolbar is
	// shown/hidden (stage grows/shrinks), the toolbar wraps, or the window resizes.
	// keepCamera=true preserves the user's zoom/pan (unlike the view-mode switch above,
	// which deliberately re-fits each pane).
	useEffect(() => {
		const el = stageRef.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(() => {
			renderingEngine?.resize(true, true);
			NV?.resizeListener();
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, [renderingEngine, NV]);

	const handlePresetClick = (preset: typeof CT_PRESETS[number]) => {
		setActivePreset(preset.name);
		handleWindowChange(preset.width, preset.center);
		showWindowReadoutBriefly();
		sessionRef.current?.log("preset", `Applied ${preset.name} window`);
	};

	// Shows the W/L readout and (re)starts its fade-out timer. Called only from actual
	// user interaction (brightness/contrast sliders, presets) — not from the initial-load
	// or deep-link window apply, which shouldn't pop the readout unprompted.
	const showWindowReadoutBriefly = () => {
		setWindowReadoutVisible(true);
		if (windowReadoutTimerRef.current) clearTimeout(windowReadoutTimerRef.current);
		windowReadoutTimerRef.current = setTimeout(() => setWindowReadoutVisible(false), 2000);
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

	// Grid placement for the asymmetric layout presets (see LAYOUT_PRESETS): the primary
	// pane spans a wide first column across all 3 rows, the other three stack down a
	// narrow second column in a fixed order. No-op outside "mpr" — the other view modes
	// already give a single pane the whole stage via panelStyle above — and for the
	// default "grid" preset, which just falls back to the plain 2×2 CSS grid.
	const paneGridStyle = (panel: ViewMode): React.CSSProperties => {
		if (viewMode !== "mpr" || layoutPreset === "grid") return {};
		const primary = LAYOUT_PRESET_PRIMARY[layoutPreset];
		if (panel === primary) return { gridColumn: "1", gridRow: "1 / span 3" };
		const secondaries = LAYOUT_PANE_ORDER.filter((p) => p !== primary);
		return { gridColumn: "2", gridRow: `${secondaries.indexOf(panel) + 1}` };
	};

	// Overlay UI for one MPR pane: the slice drag-scrollbar + "245/519" caption (bottom
	// right, only once slice info has arrived for that pane), and the W/L readout (bottom
	// left, only while showWindowReadoutBriefly's fade timer hasn't expired). Rendered as
	// siblings of the Cornerstone-owned pane div, inside the shared .vp-pane-wrap — never
	// as children of that div itself, since Cornerstone manages its children imperatively
	// and mixing React-rendered children into the same node risks the two fighting over
	// the same DOM nodes.
	const renderPaneOverlays = (pane: CinePane) => {
		const info = sliceInfo[pane];
		return (
			<>
				{info && info.total > 1 && (
					<>
						<input
							type="range"
							className="vp-slice-scrollbar"
							min={0}
							max={info.total - 1}
							step={1}
							value={info.current}
							onChange={(e) => setPaneSliceIndex(pane, Number(e.target.value))}
							aria-label={`${pane} slice`}
						/>
						<div className="vp-slice-caption">{info.current + 1}/{info.total}</div>
					</>
				)}
				<div className={`vp-window-readout${windowReadoutVisible ? " vp-window-readout--visible" : ""}`}>
					W {Math.round(windowWidth)} · L {Math.round(windowCenter)}
				</div>
			</>
		);
	};

	// Update segmentation visibility when state changes
	useEffect(() => {
		if (checkState) {
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
			// updateVisibilities(NV, checkStateArr, sessionKey, cmapRef.current);
			// }
			setVisibilities(checkStateArr);
		}
	}, [
		checkState,
		checkBoxData,
	]);

	const handleOpacityOnSliderChange = (
		event: React.ChangeEvent<HTMLInputElement>
	) => {
		const value = Number(event.target.value);
		setOpacityValue(value);
		setFillOpacity(value / 100);
		sessionRef.current?.log("opacity", `Fill opacity set to ${value}%`, 1200);
	};

	const handleOutlineOpacityChange = (
		event: React.ChangeEvent<HTMLInputElement>
	) => {
		const value = Number(event.target.value);
		setOutlineOpacityValue(value);
		setOutlineOpacity(value / 100);
		sessionRef.current?.log("opacity", `Border opacity set to ${value}%`, 1200);
	};


	// Per-organ volume (cm³) + mean HU — the existing quantitative layer the backend
	// already computes for the PDF report, surfaced inline. Fetched once, on first open.
	const loadOrganStats = async () => {
		if (organStats || statsLoading) return;
		setStatsLoading(true);
		setStatsError(false);
		try {
			const fd = new FormData();
			fd.append("sessionKey", String(caseId));
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

	// Load the population norms (static asset) + this case's full metadata row (sex/age
	// for the percentile panel, plus the rest for the case-metadata panel). Both fail
	// soft: no norms or no metadata row simply means those panels omit that data.
	// demographicsTriedRef (not "!demographics", which a case with no matching row would
	// never satisfy) guards the fetch so a missing row is only looked up once, not on
	// every panel open.
	const loadPercentileContext = async () => {
		if (!normsTried.current) {
			normsTried.current = true;
			const norms = await loadOrganNorms();
			if (norms) setOrganNorms(norms);
		}
		// Only dataset cases carry metadata; reuse the existing search endpoint (exact
		// case-id match) rather than adding a per-case metadata route.
		if (!demographicsTriedRef.current && pantsCase) {
			demographicsTriedRef.current = true;
			try {
				const res = await fetch(
					`${API_BASE}/api/search?caseid=${encodeURIComponent(pantsCase)}&per_page=1`
				);
				const data = await res.json();
				const item = Array.isArray(data.items) ? data.items[0] : null;
				if (item) {
					// Number(null) is 0, which would wrongly bucket a missing age as "0-9" —
					// so treat null/undefined/"" as unknown (null) explicitly.
					const ageRaw = item.age;
					const ageNum =
						ageRaw === null || ageRaw === undefined || ageRaw === ""
							? NaN
							: Number(ageRaw);
					setDemographics({
						sex: item.sex ?? null,
						age: Number.isFinite(ageNum) ? ageNum : null,
					});
					setCaseMetadata(item);
				}
			} catch {
				/* percentile/metadata panels just fall back to their "not available" state */
			}
		}
	};

	const handleToggleStats = () => {
		// The right-side slot is shared by stats / metadata / measurements / mask editing.
		setShowMetadata(false);
		setShowMeasurePanel(false);
		setShowEditPanel(false);
		setEditMode(null);
		setShowStats((v) => !v);
		loadOrganStats();
		loadPercentileContext();
	};

	const handleToggleMetadata = () => {
		setShowStats(false);
		setShowMeasurePanel(false);
		setShowEditPanel(false);
		setEditMode(null);
		setShowMetadata((v) => !v);
		loadPercentileContext();
	};

	const handleToggleAISidebar = () => {
		const opening = !showAISidebar;

		setShowAISidebar(opening);

		if (opening) {
			setShowStats(false);
			setShowMetadata(false);
			setShowMeasurePanel(false);
			setShowEditPanel(false);
			setEditMode(null);

			void loadOrganStats();
			void loadPercentileContext();
		}
};
// Trigger typecheck using the latest AI assistant files.
const aiActions = useMemo(() => buildViewerActions({
	checkBoxData,
	setCheckState,
	setOpacityValue,
	handleWindowChange,
	setViewModeFn: setViewMode,
	setActiveMeasureToolFn: setActiveMeasureTool,
	caseId: String(caseId),
	apiBase: API_BASE,
}), [checkBoxData, caseId, handleWindowChange]);

const statRows = useMemo(
() =>
organStats
? computeStatRows(
organStats,
organNorms,
demographics?.sex ?? null,
demographics?.age ?? null
)
: [],
[organStats, organNorms, demographics]
);
const flaggedOrgans = useMemo(() => summarizeOutOfRange(statRows), [statRows]);

// Classes created at runtime via "New class" — anything in checkBoxData whose id
// falls outside the static 32-organ catalog. Fed to OrganCheckbox as a separate
// section, since the fixed OrganSystems map has no slot for them.
const customOrgans = useMemo(
    () => checkBoxData.filter((o) => o.id > segmentation_categories.length),
    [checkBoxData]
);

const aiAvailableOrgans = useMemo(() => {
	const measuredOrgans = (organStats ?? [])
		.filter((metric) =>
			typeof metric.volume_cm3 === "number" &&
			Number.isFinite(metric.volume_cm3) &&
			metric.volume_cm3 > 0 &&
			metric.volume_cm3 !== 999999
		)
		.map((metric) => metric.organ_name);

	return measuredOrgans.length > 0
		? measuredOrgans
		: checkBoxData.map((organ) => organ.label);
}, [organStats, checkBoxData]);

	const handleDownloadClick = async () => {
		const downloadUrl = sessionId
			? `${API_BASE}/api/get_result/${sessionId}`
			: `${API_BASE}/api/download/${pantsCase}`;
		try {
			await downloadUrlAsFile(downloadUrl, `${caseId}_segmentations.zip`);
		} catch (e) {
			console.error("Segmentation download failed:", e);
			alert("Could not download segmentations. Please try again.");
		}
	};

	// hex "#rrggbb" convert to Cornerstone's [r,g,b,a] Color (0 to 255)
	const hexToColor = (hex: string): Color => {
		const n = parseInt(hex.slice(1), 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]; // Isolate red, blue, green, all values
	};

	const handleCreateClass = (name: string, colorHex: string): CheckBoxData | null => {
		const result = createNewAnnotationClass(name, hexToColor(colorHex));
		if (!result) return null;
	
		const newOrgan: CheckBoxData = { id: result.segmentIndex, label: name };
		setCheckBoxData((prev) => [...prev, newOrgan]);
		setCheckState((prev) => {
			const next = [...prev];
			next[result.segmentIndex] = true;
			return next;
		});
		setLabelColorMap((prev) => ({ ...prev, [result.segmentIndex]: result.color }));
	
		sessionRef.current?.log("edit", `Created new class "${name}"`, 2000);
		return newOrgan;
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
		const label = resolveOrganLabel(idx) ?? "Unknown";
		setToolTip({
			visible: true,
			x: e.clientX + 10,
			y: e.clientY + 10,
			text: label
		});
	};

	// Mousemove handler for the "hover to identify" tool — resolves the organ under the
	// cursor for one specific pane (via canvasToWorld, not the crosshair) and floats a
	// tooltip next to the pointer. No-ops entirely while the tool is off.
	const handlePaneHover = (pane: CinePane) => (e: MouseEvent) => {
		if (!hoverIdentifyEnabled) return;
		const idx = getOrganLabelAtPoint(pane, e.clientX, e.clientY);
		if (!idx) {
			setHoverOrganTip((t) => (t.visible ? { ...t, visible: false } : t));
			return;
		}
		const rawLabel = resolveOrganLabel(idx);
		setHoverOrganTip({
			visible: true,
			x: e.clientX + 14,
			y: e.clientY + 14,
			text: rawLabel?? "Unknown",
			// Same LUT the mask overlay is rendered with, so the swatch/border always
			// matches the color the organ is actually painted in the pane.
			color: colorToCss(labelColorMap[idx]),
		});
	};

	const handlePaneHoverLeave = () => {
		setHoverOrganTip((t) => (t.visible ? { ...t, visible: false } : t));
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
			className={`VisualizationPage${showAISidebar ? " ai-panel-open" : ""}`}
			style={{
				display: "flex",
				overflow: "hidden",
				flexDirection: "column",
				height: "100vh",
				width: "100vw",
			}}
		>
			{/* ---- Top toolbar (PYCAD-style). Lives in normal flow, so it sits ABOVE the
			     viewports and never overlays them. Shown/hidden by the gear button. ---- */}
			{showToolbar && (
				<div className="vp-topbar" ref={topbarRef}>
					{/* Gear (hides the bar) + home, in-flow so there's no dead corner space */}
					<button
						className="vp-iconbtn"
						title="Hide toolbar"
						aria-label="Toggle toolbar"
						onClick={() => setShowToolbar(false)}
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

					<span className="vp-tb-divider" />

					{/* Case / session identity */}
					<div className="vp-tb-id">
						<span className="vp-tb-id__eyebrow">{sessionId ? "Session" : "Case"}</span>
						<span className="vp-tb-id__val">{caseId}</span>
					</div>

					<span className="vp-tb-divider" />

					{/* Layout ▾ — view mode (MPR/Axial/Sag/Cor/3D) and, while in MPR, the
					    pane-layout preset (which pane is enlarged) — both are "ways to view /
					    arrange the scan," so they share one dropdown instead of two permanently
					    visible rows of segmented buttons. Stays open on selection (a config
					    panel, not a pick-and-dismiss menu) so both pickers can be used in one visit. */}
					<div className="vp-toolgroup" ref={layoutFlyout.groupRef}>
						<button
							ref={layoutFlyout.btnRef}
							className={`vp-tb-mini vp-tb-mini--flyout ${layoutFlyout.open ? "vp-tb-mini--active" : ""}`}
							onClick={layoutFlyout.toggle}
							aria-label="Layout"
							aria-haspopup="menu"
							aria-expanded={layoutFlyout.open}
						>
							<span>{layoutTriggerLabel}</span>
							<IconChevronDown size={13} />
						</button>
						{layoutFlyout.open && layoutFlyout.pos &&
							createPortal(
								<div
									className="vp-flyout vp-flyout--config"
									role="menu"
									ref={layoutFlyout.menuRef}
									style={{ position: "fixed", top: layoutFlyout.pos.top, left: layoutFlyout.pos.left }}
								>
									<span className="vp-panel__title">View</span>
									<div className="vp-seg" role="group" aria-label="View layout">
										{VIEW_MODE_OPTIONS.map(({ mode, label }) => (
											<button
												key={mode}
												onClick={() => setViewMode(mode)}
												className={`vp-seg__btn ${viewMode === mode ? "vp-seg__btn--active" : ""}`}
											>{label}</button>
										))}
									</div>
									{viewMode === "mpr" && (
										<>
											<span className="vp-panel__title">Panes</span>
											<div className="vp-seg" role="group" aria-label="Pane layout">
												{LAYOUT_PRESETS.map(({ id, label }) => (
													<button
														key={id}
														onClick={() => setLayoutPreset(id)}
														className={`vp-seg__btn ${layoutPreset === id ? "vp-seg__btn--active" : ""}`}
													>{label}</button>
												))}
											</div>
										</>
									)}
								</div>,
								document.body
							)}
					</div>

					<span className="vp-tb-divider" />

					{/* Window ▾ — CT presets. Trigger shows the active preset's name; stays
					    open (a config panel) so presets can be flipped through quickly. */}
					<div className="vp-toolgroup" ref={windowFlyout.groupRef}>
						<button
							ref={windowFlyout.btnRef}
							className={`vp-tb-mini vp-tb-mini--flyout ${windowFlyout.open ? "vp-tb-mini--active" : ""}`}
							onClick={windowFlyout.toggle}
							aria-label="CT window preset"
							aria-haspopup="menu"
							aria-expanded={windowFlyout.open}
						>
							<span>{activePreset || "Window"}</span>
							<IconChevronDown size={13} />
						</button>
						{windowFlyout.open && windowFlyout.pos &&
							createPortal(
								<div
									className="vp-flyout vp-flyout--config"
									role="menu"
									ref={windowFlyout.menuRef}
									style={{ position: "fixed", top: windowFlyout.pos.top, left: windowFlyout.pos.left }}
								>
									{CT_PRESETS.map((preset) => (
										<button
											key={preset.name}
											className={`vp-flyout__item ${activePreset === preset.name ? "is-active" : ""}`}
											role="menuitem"
											onClick={() => handlePresetClick(preset)}
										>
											<span>{preset.name}</span>
										</button>
									))}
								</div>,
								document.body
							)}
					</div>

					<span className="vp-tb-divider" />

					{/* Adjust ▾ — mask fill/border opacity, brightness, contrast, zoom, plus
					    center/reset. A live panel (stays open) so the sliders can be dragged
					    without the menu closing after each change. */}
					<div className="vp-toolgroup" ref={adjustFlyout.groupRef}>
						<button
							ref={adjustFlyout.btnRef}
							className={`vp-tool ${adjustFlyout.open ? "vp-tool--active" : ""}`}
							onClick={adjustFlyout.toggle}
							aria-label="Adjust"
							aria-haspopup="menu"
							aria-expanded={adjustFlyout.open}
						>
							<IconAdjustmentsHorizontal size={20} color={adjustFlyout.open ? "#08090b" : "white"} />
							<span className="vp-tool__caret" />
							<span className="vp-tool__tip">Adjust</span>
						</button>
						{adjustFlyout.open && adjustFlyout.pos &&
							createPortal(
								<div
									className="vp-flyout vp-flyout--adjust"
									role="menu"
									ref={adjustFlyout.menuRef}
									style={{ position: "fixed", top: adjustFlyout.pos.top, left: adjustFlyout.pos.left }}
								>
									{!isDicom && (
										<>
											<label className="vp-tb-slider" title="Mask fill opacity">
												<span className="vp-tb-slider__label">Fill</span>
												<input
													type="range" min="0" max="100" step="1" className="vp-range"
													aria-label="Mask fill opacity"
													value={opacityValue}
													onChange={handleOpacityOnSliderChange}
												/>
												<span className="vp-tb-slider__val">{Math.round(opacityValue)}%</span>
											</label>
											<label className="vp-tb-slider" title="Mask border opacity">
												<span className="vp-tb-slider__label">Border</span>
												<input
													type="range" min="0" max="100" step="1" className="vp-range"
													aria-label="Mask border opacity"
													value={outlineOpacityValue}
													onChange={handleOutlineOpacityChange}
												/>
												<span className="vp-tb-slider__val">{Math.round(outlineOpacityValue)}%</span>
											</label>
										</>
									)}
									<label className="vp-tb-slider" title="Brightness (window level)">
										<span className="vp-tb-slider__label">Brt</span>
										<input
											type="range" min="-1000" max="1000" step="1" className="vp-range"
											aria-label="Brightness"
											value={windowCenter * -1}
											onChange={(e) => {
												handleWindowChange(null, Number(e.target.value) * -1);
												showWindowReadoutBriefly();
											}}
										/>
									</label>
									<label className="vp-tb-slider" title="Contrast (window width)">
										<span className="vp-tb-slider__label">Con</span>
										<input
											type="range" min="1" max="2000" step="1" className="vp-range"
											aria-label="Contrast"
											value={windowWidth}
											onChange={(e) => {
												handleWindowChange(Number(e.target.value), null);
												showWindowReadoutBriefly();
											}}
										/>
									</label>
									<label className="vp-tb-slider" title="Zoom">
										<span className="vp-tb-slider__label">Zoom</span>
										<input
											type="range" min="0.5" max="2" step="0.05" className="vp-range"
											aria-label="Zoom"
											value={zoomLevel}
											onChange={(e) => setZoomLevel(Number(e.target.value))}
										/>
										<span className="vp-tb-slider__val">{zoomLevel.toFixed(1)}×</span>
									</label>
									<div className="vp-flyout--adjust__actions">
										<button className="vp-tb-mini" onClick={() => centerOnCursor()} title="Center on crosshair">Center</button>
										<button
											className="vp-tb-mini"
											onClick={() => {
												// Also undoes any oblique-plane rotation from the crosshair's
												// rotate handles, back to standard axial/sagittal/coronal.
												resetMprOrientation();
												zoomToFit();
												setZoomLevel(1);
											}}
											title="Reset zoom, pan & MPR orientation"
										>Reset</button>
									</div>
								</div>,
								document.body
							)}
					</div>

					<span className="vp-tb-divider" />

					{/* Tools */}
									<div className="vp-toolrow vp-tb-tools">
										{/* Crosshair stays inline — it's the default/most-used navigation mode, not
										    worth burying behind a menu. Everything else below is grouped into
										    dropdowns (same portal-flyout pattern as Measure/Cine originally used)
										    so the bar reads as ~9 clusters instead of ~20 individual icons. */}
										<button
												className={`vp-tool ${crosshairToolActive && !activeMeasureTool && !editMode ? "vp-tool--active" : ""}`}
												onClick={() => {
													setEditMode(null);
													setActiveMeasureTool(null);
													setCrosshairToolActive((prev) => !prev);
												}}
												aria-label="Crosshair mode"
											>
												<IconPointer size={20} color={crosshairToolActive && !activeMeasureTool && !editMode ? "#08090b" : "white"} />
												<span className="vp-tool__tip">Crosshair</span>
											</button>

											{/* Measure ▾ — measurement tools + the magnify loupe (shares the same
											    primary-mouse-tool slot) + clear. */}
											<div className="vp-toolgroup" ref={measureFlyout.groupRef}>
												<button
													ref={measureFlyout.btnRef}
													className={`vp-tool ${measureToolActive || measureFlyout.open ? "vp-tool--active" : ""}`}
													onClick={measureFlyout.toggle}
													aria-label="Measurement tools"
													aria-haspopup="menu"
													aria-expanded={measureFlyout.open}
												>
													<ActiveMeasureIcon size={20} color={measureToolActive || measureFlyout.open ? "#08090b" : "white"} />
													<span className="vp-tool__caret" />
													<span className="vp-tool__tip">Measure</span>
												</button>
												{measureFlyout.open && measureFlyout.pos &&
													createPortal(
														<div
															className="vp-flyout"
															role="menu"
															ref={measureFlyout.menuRef}
															style={{ position: "fixed", top: measureFlyout.pos.top, left: measureFlyout.pos.left }}
														>
															{MEASURE_TOOLS.map(({ name, label, Icon, key: hotkey }) => (
																<button
																	key={name}
																	className={`vp-flyout__item ${activeMeasureTool === name ? "is-active" : ""}`}
																	role="menuitem"
																	onClick={() => {
																		setEditMode(null);
																		setActiveMeasureTool((p) => (p === name ? null : name));
																		measureFlyout.close();
																	}}
																>
																	<Icon size={18} />
																	<span>{label}</span>
																	<span className="vp-flyout__kbd">{hotkey}</span>
																</button>
															))}
															<button
																className="vp-flyout__item"
																role="menuitem"
																onClick={() => {
																	clearMeasurements();
																	measureFlyout.close();
																}}
															>
																<IconTrash size={18} />
																<span>Clear measurements</span>
															</button>
														</div>,
														document.body
													)}
											</div>

											{/* View ▾ — hover-identify + reference lines (toggles) and flip/rotate
											    (one-shot actions on the focused pane). */}
											<div className="vp-toolgroup" ref={viewFlyout.groupRef}>
												<button
													ref={viewFlyout.btnRef}
													className={`vp-tool ${viewGroupActive || viewFlyout.open ? "vp-tool--active" : ""}`}
													onClick={viewFlyout.toggle}
													aria-label="View options"
													aria-haspopup="menu"
													aria-expanded={viewFlyout.open}
												>
													<IconEye size={20} color={viewGroupActive || viewFlyout.open ? "#08090b" : "white"} />
													<span className="vp-tool__caret" />
													<span className="vp-tool__tip">View</span>
												</button>
												{viewFlyout.open && viewFlyout.pos &&
													createPortal(
														<div
															className="vp-flyout"
															role="menu"
															ref={viewFlyout.menuRef}
															style={{ position: "fixed", top: viewFlyout.pos.top, left: viewFlyout.pos.left }}
														>
															<button
																className={`vp-flyout__item ${hoverIdentifyEnabled ? "is-active" : ""}`}
																role="menuitem"
																title="Name the organ under the cursor"
																onClick={() => {
																	setHoverIdentifyEnabled((v) => !v);
																	setHoverOrganTip((t) => (t.visible ? { ...t, visible: false } : t));
																	viewFlyout.close();
																}}
															>
																<IconScanEye size={18} />
																<span>{hoverIdentifyEnabled ? "Hover identify: on" : "Hover identify"}</span>
															</button>
															<button
																className={`vp-flyout__item ${referenceLinesOn ? "is-active" : ""}`}
																role="menuitem"
																title="Dotted line in the other panes for whichever pane you scroll"
																onClick={() => {
																	setReferenceLinesOn((v) => !v);
																	viewFlyout.close();
																}}
															>
																<IconGrid3x3 size={18} />
																<span>{referenceLinesOn ? "Reference lines: on" : "Reference lines"}</span>
															</button>
															<button
																className="vp-flyout__item"
																role="menuitem"
																title="The focused pane — last one scrolled or clicked"
																onClick={() => {
																	handleFlipHorizontal();
																	viewFlyout.close();
																}}
															>
																<IconFlipHorizontal size={18} />
																<span>Flip horizontal</span>
															</button>
															<button
																className="vp-flyout__item"
																role="menuitem"
																title="The focused pane — last one scrolled or clicked"
																onClick={() => {
																	handleRotate90Clockwise();
																	viewFlyout.close();
																}}
															>
																<IconRotateClockwise size={18} />
																<span>Rotate 90° clockwise</span>
															</button>
														</div>,
														document.body
													)}
											</div>

											{/* Cine ▾ — the one flyout that stays open on click: a live mini-panel
											    (play/pause + FPS side by side), not a pick-and-dismiss menu. */}
											<div className="vp-toolgroup" ref={cineFlyout.groupRef}>
												<button
													ref={cineFlyout.btnRef}
													className={`vp-tool ${cinePlaying || cineFlyout.open ? "vp-tool--active" : ""}`}
													onClick={cineFlyout.toggle}
													aria-label="Cine controls"
													aria-haspopup="menu"
													aria-expanded={cineFlyout.open}
												>
													{cinePlaying ? (
														<IconPlayerPause size={20} color={cineFlyout.open ? "#08090b" : "white"} />
													) : (
														<IconPlayerPlay size={20} color={cineFlyout.open ? "#08090b" : "white"} />
													)}
													<span className="vp-tool__tip">
														{cinePlaying ? `Cine playing (${cineFps} fps) — click for controls` : "Cine controls (V to play)"}
													</span>
												</button>
												{cineFlyout.open && cineFlyout.pos &&
													createPortal(
														<div
															className="vp-flyout vp-flyout--cine"
															role="menu"
															ref={cineFlyout.menuRef}
															style={{ position: "fixed", top: cineFlyout.pos.top, left: cineFlyout.pos.left }}
														>
															<button
																className={`vp-tool vp-tool--cine-play ${cinePlaying ? "vp-tool--active" : ""}`}
																onClick={toggleCine}
																aria-label={cinePlaying ? "Pause cine playback" : "Play cine playback"}
															>
																{cinePlaying ? (
																	<IconPlayerPause size={20} color="#08090b" />
																) : (
																	<IconPlayerPlay size={20} color="white" />
																)}
															</button>
															<label className="vp-tb-slider vp-tb-slider--cine" title="Cine playback speed">
																<span className="vp-tb-slider__label">FPS</span>
																<input
																	type="range" min="1" max="100" step="1" className="vp-range"
																	aria-label="Cine frames per second"
																	value={cineFps}
																	onChange={(e) => handleCineFpsChange(Number(e.target.value))}
																/>
																<span className="vp-tb-slider__val">{cineFps}</span>
															</label>
														</div>,
														document.body
													)}
											</div>

											{/* Undo/redo stay standalone (not grouped) — they're used constantly
											    during a review and shouldn't cost an extra click to reach. Cover
											    measurements as well as mask edits; ⌘Z/⇧⌘Z work everywhere too. */}
											<button
												className="vp-tool"
												onClick={() => undoMaskEdit()}
												aria-label="Undo"
											>
												<IconArrowBackUp size={20} color="white" />
												<span className="vp-tool__tip">Undo (⌘Z) — measurements & mask edits</span>
											</button>
											<button
												className="vp-tool"
												onClick={() => redoMaskEdit()}
												aria-label="Redo"
											>
												<IconArrowForwardUp size={20} color="white" />
												<span className="vp-tool__tip">Redo (⇧⌘Z)</span>
											</button>
											{!isDicom && (
												<button
													className={`vp-tool ${showEditPanel || editMode ? "vp-tool--active" : ""}`}
													onClick={() => {
														setShowStats(false);
														setShowMetadata(false);
														setShowMeasurePanel(false);
														setShowEditPanel((v) => {
															const next = !v;
															if (!next) setEditMode(null);
															return next;
														});
													}}
													aria-label="Edit masks"
												>
													<IconBrush size={20} color={showEditPanel || editMode ? "#08090b" : "white"} />
													<span className="vp-tool__tip">Edit masks</span>
												</button>
											)}

											{/* Capture ▾ — snapshot, voice-narrated reading session, share link. */}
											<div className="vp-toolgroup" ref={captureFlyout.groupRef}>
												<button
													ref={captureFlyout.btnRef}
													className={`vp-tool ${readingSession ? "vp-tool--rec" : ""} ${captureFlyout.open ? "vp-tool--active" : ""}`}
													onClick={captureFlyout.toggle}
													aria-label="Capture and session tools"
													aria-haspopup="menu"
													aria-expanded={captureFlyout.open}
												>
													<IconCamera size={20} color={captureFlyout.open ? "#08090b" : "white"} />
													<span className="vp-tool__caret" />
													<span className="vp-tool__tip">
														{readingSession ? "Recording — capture / share" : "Capture"}
													</span>
												</button>
												{captureFlyout.open && captureFlyout.pos &&
													createPortal(
														<div
															className="vp-flyout"
															role="menu"
															ref={captureFlyout.menuRef}
															style={{ position: "fixed", top: captureFlyout.pos.top, left: captureFlyout.pos.left }}
														>
															<button
																className="vp-flyout__item"
																role="menuitem"
																onClick={() => {
																	void takeSnapshot();
																	captureFlyout.close();
																}}
															>
																<IconCamera size={18} />
																<span>Snapshot</span>
																<span className="vp-flyout__kbd">S</span>
															</button>
															<button
																className={`vp-flyout__item ${readingSession ? "is-active" : ""}`}
																role="menuitem"
																disabled={sessionStarting}
																onClick={() => {
																	if (readingSession) void stopReadingSession();
																	else void startReadingSession();
																	captureFlyout.close();
																}}
															>
																<IconMicrophone size={18} />
																<span>
																	{readingSession
																		? "Stop reading session"
																		: sessionStarting
																			? "Starting…"
																			: "Record reading session"}
																</span>
															</button>
															{!isDicom && (
																<button
																	className="vp-flyout__item"
																	role="menuitem"
																	onClick={() => {
																		void handleShare();
																		captureFlyout.close();
																	}}
																>
																	{shareCopied ? <IconCheck size={18} /> : <IconShare size={18} />}
																	<span>{shareCopied ? "Link copied!" : "Share this view"}</span>
																</button>
															)}
														</div>,
														document.body
													)}
											</div>

											{/* Panels ▾ — every side-panel opener in one place (organs list, organ
											    stats, case metadata, measurements). */}
											<div className="vp-toolgroup" ref={panelsFlyout.groupRef}>
												<button
													ref={panelsFlyout.btnRef}
													className={`vp-tool ${panelsGroupActive || panelsFlyout.open ? "vp-tool--active" : ""}`}
													onClick={panelsFlyout.toggle}
													aria-label="Panels"
													aria-haspopup="menu"
													aria-expanded={panelsFlyout.open}
												>
													<IconLayoutSidebarRight size={20} color={panelsGroupActive || panelsFlyout.open ? "#08090b" : "white"} />
													<span className="vp-tool__caret" />
													<span className="vp-tool__tip">Panels</span>
												</button>
												{panelsFlyout.open && panelsFlyout.pos &&
													createPortal(
														<div
															className="vp-flyout"
															role="menu"
															ref={panelsFlyout.menuRef}
															style={{ position: "fixed", top: panelsFlyout.pos.top, left: panelsFlyout.pos.left }}
														>
															{!isDicom && (
																<button
																	className={`vp-flyout__item ${showOrganDetails ? "is-active" : ""}`}
																	role="menuitem"
																	onClick={() => {
																		if (showOrganDetails) {
																			setShowOrganDetails(false);
																		} else {
																			setShowStats(false);
																			setShowMetadata(false);
																			setShowMeasurePanel(false);
																			setShowOrganDetails(true);
																		}
																		panelsFlyout.close();
																	}}
																>
																	<IconStack2 size={18} />
																	<span>Organs</span>
																</button>
															)}
															{!isDicom && (
																<button
																	className={`vp-flyout__item ${showStats ? "is-active" : ""}`}
																	role="menuitem"
																	onClick={() => {
																		handleToggleStats();
																		panelsFlyout.close();
																	}}
																>
																	<IconChartBar size={18} />
																	<span>Organ stats</span>
																</button>
															)}
															{!isDicom && (
																<button
																	className={`vp-flyout__item ${showMetadata ? "is-active" : ""}`}
																	role="menuitem"
																	onClick={() => {
																		handleToggleMetadata();
																		panelsFlyout.close();
																	}}
																>
																	<IconId size={18} />
																	<span>Case metadata</span>
																</button>
															)}
															<button
																className={`vp-flyout__item ${showMeasurePanel ? "is-active" : ""}`}
																role="menuitem"
																onClick={() => {
																	setShowStats(false);
																	setShowMetadata(false);
																	setShowEditPanel(false);
																	setEditMode(null);
																	setShowMeasurePanel((v) => !v);
																	panelsFlyout.close();
																}}
															>
																<IconListDetails size={18} />
																<span>Measurements</span>
																<span className="vp-flyout__kbd">M</span>
															</button>
														</div>,
														document.body
													)}
											</div>

											{/* Report and Download stay standalone and separate (not grouped with
											    each other) — distinct export actions users reach for independently. */}
											{!isDicom && (
												<button
													className="vp-tool"
													onClick={handleDownloadClick}
													aria-label="Download segmentations"
												>
													<IconDownload size={20} color="white" />
													<span className="vp-tool__tip">Download</span>
												</button>
											)}
											{!isDicom && (
												<button
													className="vp-tool"
													onClick={() => setShowReportScreen(true)}
													aria-label="Open report"
												>
													<IconReport size={20} color="white" />
													<span className="vp-tool__tip">Report</span>
												</button>
											)}

											{/* HD and AI stay inline: HD is a live status indicator (streaming %),
											    and AI is a headline feature — neither belongs buried in a menu. */}
											{!sessionId && localAvailable && (
												<button
													className={`vp-tool ${isHd || enhance.state === "done" ? "vp-tool--active" : ""} ${enhance.state === "streaming" ? "vp-tool--busy" : ""}`}
													onClick={() => {
														// Full-res streams in automatically and swaps in place; the button
														// is the status + manual trigger, with reload as the failure path.
														if (isHd) toggleHd();
														else if (enhance.state === "idle") void runEnhance();
														else if (enhance.state === "failed") toggleHd();
													}}
													aria-label="Full resolution"
												>
													<span style={{ fontFamily: "var(--vp-mono)", fontSize: "12px", fontWeight: 700 }}>
														{enhance.state === "streaming" ? `${enhance.pct ?? 0}%` : "HD"}
													</span>
													<span className="vp-tool__tip">
														{isHd
															? "Full res · click for fast"
															: enhance.state === "streaming"
																? `Enhancing to full resolution… ${enhance.pct ?? 0}%`
																: enhance.state === "done"
																	? "Full resolution ✓"
																	: enhance.state === "failed"
																		? "Enhance failed — click to reload in HD"
																		: "Load full resolution"}
													</span>
												</button>
											)}
											{!isDicom && (
												<button
													type="button"
													className={`vp-tool ${showAISidebar ? "vp-tool--active" : ""}`}
													onClick={handleToggleAISidebar}
													aria-label={
														showAISidebar
														? "Close BodyMaps AI"
														: "Open BodyMaps AI"
													}
													aria-expanded={showAISidebar}
												>
													<span
														style={{
															fontFamily: "var(--vp-mono)",
															fontSize: "12px",
															fontWeight: 700,
														}}
													>
														AI
													</span>
													<span className="vp-tool__tip">
														{showAISidebar ? "Close BodyMaps AI" : "BodyMaps AI"}
													</span>
												</button>
											)}
										</div>
				</div>
			)}

			{/* When the toolbar is hidden, a single floating gear reveals it. */}
			{!showToolbar && (
				<button
					className="vp-floating-gear vp-iconbtn"
					title="Show toolbar"
					aria-label="Toggle toolbar"
					onClick={() => setShowToolbar(true)}
				>
					<IconSettings size={20} color="white" />
				</button>
			)}

			{/* Body row: left dock (Organs) · stage · right docks (stats/measurements/
			     edit/AI). Docked panels sit IN FLOW beside the viewports — they push the
			     stage narrower instead of overlaying it (same principle as the toolbar
			     above pushing it down). The stage's ResizeObserver refits the canvases
			     whenever a dock opens or closes. */}
			<div className="vp-body">
				{!isDicom && (
					<OrganCheckbox
						setCheckState={setCheckState}
						checkState={checkState}
						sessionId={sessionId}
						setShowOrganDetails={setShowOrganDetails}
						showOrganDetails={showOrganDetails}
						labelColorMap={labelColorMap}
						onJumpToOrgan={handleJumpToOrgan}
						customOrgans={customOrgans}
					/>
				)}

			{/* Stage — fills the space below the toolbar; the viewports live here. */}
			<div className="vp-stage" ref={stageRef}>

				{loading ? (
					<div className="vp-loading">
						<div className="vp-spinner" />
						<div className="vp-loading__text">Preparing case {caseId}…</div>
						{pantsCase && (dlDone || dlPct != null) && (
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
				) : null}
				<div
					className="visualization-container"
					ref={VisualizationContainer_ref}
					style={{
						overflow: "hidden",
						// Collapse to a single cell only for the 2D single views. MPR keeps a grid
						// (2×2 by default, or a wide primary column + narrow stacked column for an
						// asymmetric layout preset); 3D also keeps the 2×2 grid underneath since it
						// just overlays the render pane on top of it.
						...(viewMode !== "mpr" && viewMode !== "3d"
							? { gridTemplateColumns: "1fr", gridTemplateRows: "1fr" }
							: viewMode === "mpr" && layoutPreset !== "grid"
								? { gridTemplateColumns: "2fr 1fr", gridTemplateRows: "1fr 1fr 1fr" }
								: {}),
					}}
				>
					<div className="vp-pane-wrap" style={{ ...panelStyle("axial"), ...paneGridStyle("axial") }}>
						<div
							className={`axial ${loading ? "" : "vp-pane vp-pane--axial"}${hoverIdentifyEnabled ? " vp-pane--hover-identify" : ""}`}
							data-label="Axial"
							ref={axial_ref}
							onClick={(e) => { handleMouseClick(e); }}
							onMouseDown={handlePaneMouseDown("axial")}
							onMouseMove={handlePaneHover("axial")}
							onMouseLeave={handlePaneHoverLeave}
							onWheel={handlePaneWheel("axial")}
						></div>
						{!loading && renderPaneOverlays("axial")}
					</div>
					<div className="vp-pane-wrap" style={{ ...panelStyle("sagittal"), ...paneGridStyle("sagittal") }}>
						<div
							className={`sagittal ${loading ? "" : "vp-pane vp-pane--sagittal"}${hoverIdentifyEnabled ? " vp-pane--hover-identify" : ""}`}
							data-label="Sagittal"
							ref={sagittal_ref}
							onClick={(e) => { handleMouseClick(e); }}
							onMouseDown={handlePaneMouseDown("sagittal")}
							onMouseMove={handlePaneHover("sagittal")}
							onMouseLeave={handlePaneHoverLeave}
							onWheel={handlePaneWheel("sagittal")}
						></div>
						{!loading && renderPaneOverlays("sagittal")}
					</div>

					<div className="vp-pane-wrap" style={{ ...panelStyle("coronal"), ...paneGridStyle("coronal") }}>
						<div
							className={`coronal ${loading ? "" : "vp-pane vp-pane--coronal"}${hoverIdentifyEnabled ? " vp-pane--hover-identify" : ""}`}
							data-label="Coronal"
							ref={coronal_ref}
							onClick={(e) => { handleMouseClick(e); }}
							onMouseDown={handlePaneMouseDown("coronal")}
							onMouseMove={handlePaneHover("coronal")}
							onMouseLeave={handlePaneHoverLeave}
							onWheel={handlePaneWheel("coronal")}
						></div>
						{!loading && renderPaneOverlays("coronal")}
					</div>

					<div className={`render ${loading ? "" : "vp-pane vp-pane--render"}`} data-label="3D" style={{ ...panelStyle("3d"), ...paneGridStyle("3d") }}>
						<div className="canvas">
							{threeDMode === "volume" ? (
								volume3DFailed ? (
									<div className="vp-3d-empty">
										Volume rendering isn't available here
										<span>(needs GPU/WebGL rendering)</span>
									</div>
								) : (
									// Shaded ray-cast rendering of the CT itself (Cornerstone VOLUME_3D).
									<div className="vp-vol3d" ref={volume3DRef} />
								)
							) : isDicom ? (
								// Meshes come from the case's segmentation on the server — a local
								// DICOM scan has none.
								<div className="vp-3d-empty">
									No organ meshes for local DICOM
									<span>(switch to Volume rendering above)</span>
								</div>
							) : (
								<SegmentationMeshViewer caseId={caseId} crosshairMm={crosshairMm} checkState={checkState} loading={loading} opacity={opacityValue} customOrgans={customOrgans} labelColorMap={labelColorMap} />
							)}
						</div>
						{!loading && (
							<div className="vp-3dbar">
								{!isDicom && (
									<button
										className={`vp-3dbar__btn ${threeDMode === "mesh" ? "is-active" : ""}`}
										onClick={() => setThreeDMode("mesh")}
									>
										Meshes
									</button>
								)}
								<button
									className={`vp-3dbar__btn ${threeDMode === "volume" ? "is-active" : ""}`}
									onClick={() => {
										setThreeDMode("volume");
										sessionRef.current?.log("view", "Switched 3D pane to volume rendering");
									}}
								>
									Volume
								</button>
								{threeDMode === "volume" && !volume3DFailed && (
									<span className="vp-3dbar__presets">
										{volume3DPresets.map((preset) => (
											<button
												key={preset.name}
												className={`vp-3dbar__btn vp-3dbar__btn--preset ${volumePreset === preset.name ? "is-active" : ""}`}
												onClick={() => setVolumePreset(preset.name)}
											>
												{preset.label}
											</button>
										))}
									</span>
								)}
							</div>
						)}
					</div>
				</div>
			</div>

			{hoverOrganTip.visible && (
				<div
					className="vp-organ-tip"
					style={{ left: hoverOrganTip.x, top: hoverOrganTip.y, borderLeftColor: hoverOrganTip.color }}
				>
					<span className="vp-organ-tip__swatch" style={{ background: hoverOrganTip.color }} />
					{hoverOrganTip.text}
				</div>
			)}

			{showStats && (
				<div className="vp-stats">
					<div className="vp-stats__head">
						<span className="vp-panel__title">Organ Statistics</span>
						<div className="vp-stats__actions">
							{statRows.length > 0 && (
								<>
									<button
										className="vp-stats__export"
										onClick={() => downloadStats(statRows, "csv", caseId)}
										title="Download as CSV"
									>
										CSV
									</button>
									<button
										className="vp-stats__export"
										onClick={() => downloadStats(statRows, "json", caseId)}
										title="Download as JSON"
									>
										JSON
									</button>
								</>
							)}
							<button
								className="vp-stats__close"
								onClick={() => setShowStats(false)}
								aria-label="Close organ statistics"
							>
								×
							</button>
						</div>
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
					) : statRows.length > 0 ? (
						<>
							{flaggedOrgans.length > 0 && (
								<div className="vp-stats__summary">
									<strong>{flaggedOrgans.length}</strong>{" "}
									{flaggedOrgans.length === 1 ? "organ" : "organs"} outside the p5–p95 range:{" "}
									{flaggedOrgans
										.map((o) => `${o.label} (p${Math.round(o.percentile)})`)
										.join(", ")}
								</div>
							)}
							<div className={`vp-stats__table${organNorms ? " vp-stats__table--pct" : ""}`}>
								<div className="vp-stats__row vp-stats__row--head">
									<span>Organ</span>
									<span>Volume</span>
									<span>Mean HU</span>
									{organNorms && <span title="Volume percentile vs the dataset">%ile</span>}
								</div>
								{statRows.map((r, i) => {
									const flagged = r.percentile !== null && (r.percentile < 5 || r.percentile > 95);
									const expanded = expandedStatRow === i;
									return (
										<React.Fragment key={`${r.organ_name}-${i}`}>
											<div
												className={`vp-stats__row vp-stats__row--expandable${i % 2 === 1 ? " vp-stats__row--odd" : ""}`}
												role="button"
												tabIndex={0}
												aria-expanded={expanded}
												onClick={() => setExpandedStatRow(expanded ? null : i)}
												onKeyDown={(e) => {
													if (e.key === "Enter" || e.key === " ") {
														e.preventDefault();
														setExpandedStatRow(expanded ? null : i);
													}
												}}
											>
												<span>
													<span className={`vp-stats__chevron${expanded ? " vp-stats__chevron--open" : ""}`}>
														›
													</span>
													{r.label}
													{r.truncated && (
														<span className="vp-stats__truncated-flag" title="Mask reaches the volume edge — metrics may be clipped">
															⚠
														</span>
													)}
												</span>
												<span>{r.volume_cm3 === null ? "NA" : `${Math.round(r.volume_cm3)} cm³`}</span>
												<span>{r.mean_hu === null ? "NA" : Math.round(r.mean_hu)}</span>
												{organNorms && (
													<span
														className={`vp-stats__pct${flagged ? " vp-stats__pct--flag" : ""}`}
														title={
															r.percentile !== null
																? `${Math.round(r.percentile)}th percentile vs ${describeBasis(r.basis as string)} (n=${r.n})`
																: "No reference group for this organ"
														}
													>
														{r.percentile !== null ? (
															<>
																<span className="vp-stats__pctnum">p{Math.round(r.percentile)}</span>
																<PercentileBar percentile={r.percentile} flagged={flagged} />
															</>
														) : (
															"—"
														)}
													</span>
												)}
											</div>
											{expanded && (
												<div className="vp-stats__detail">
													<div className="vp-stats__detail-item">
														<span>Median HU</span>
														<span>{fmtStat(r.median)}</span>
													</div>
													<div className="vp-stats__detail-item">
														<span>Std Dev HU</span>
														<span>{fmtStat(r.standard_deviation)}</span>
													</div>
													<div className="vp-stats__detail-item">
														<span>Min HU</span>
														<span>{fmtStat(r.min_value)}</span>
													</div>
													<div className="vp-stats__detail-item">
														<span>Max HU</span>
														<span>{fmtStat(r.max_value)}</span>
													</div>
													<div className="vp-stats__detail-item">
														<span>Skewness</span>
														<span>{fmtStat(r.skewness, 2)}</span>
													</div>
													<div className="vp-stats__detail-item">
														<span>Kurtosis</span>
														<span>{fmtStat(r.kurtosis, 2)}</span>
													</div>
													<div className="vp-stats__detail-item">
														<span>Voxel Count</span>
														<span>{r.voxel_count === null ? "—" : r.voxel_count.toLocaleString()}</span>
													</div>
													<div className="vp-stats__detail-item">
														<span>Truncated</span>
														<span>{r.truncated ? "Yes" : "No"}</span>
													</div>
												</div>
											)}
										</React.Fragment>
									);
								})}
							</div>
						</>
					) : (
						<div className="vp-stats__msg">No organ data available.</div>
					)}
				</div>
			)}

			{showMetadata && (
				<div className="vp-stats">
					<div className="vp-stats__head">
						<span className="vp-panel__title">Case Metadata</span>
						<button
							className="vp-stats__close"
							onClick={() => setShowMetadata(false)}
							aria-label="Close case metadata"
						>
							×
						</button>
					</div>
					{!pantsCase ? (
						<div className="vp-stats__msg">
							Case metadata is only available for dataset cases.
						</div>
					) : !caseMetadata ? (
						<div className="vp-stats__msg">
							{demographicsTriedRef.current
								? "No metadata available for this case."
								: "Loading…"}
						</div>
					) : (
						<div className="vp-meta__list">
							{METADATA_FIELDS.map(({ key, label }, i) => (
								<div className={`vp-meta__row${i % 2 === 1 ? " vp-meta__row--odd" : ""}`} key={key}>
									<span className="vp-meta__label">{label}</span>
									<span className="vp-meta__value">
										{formatMetaValue(key, caseMetadata[key])}
									</span>
								</div>
							))}
						</div>
					)}
				</div>
			)}

			{showMeasurePanel && (
				<MeasurementPanel
					onClose={() => setShowMeasurePanel(false)}
					onJump={(mm) => setCrosshairMm(mm)}
				/>
			)}

			{showEditPanel && (
				<MaskEditPanel
					organs={checkBoxData}
					caseId={String(caseId)}
					serverCaseId={pantsCase}
					mode={editMode}
					onModeChange={setEditMode}
					onClose={() => {
						setShowEditPanel(false);
						setEditMode(null);
					}}
					onEdit={(detail) => sessionRef.current?.log("edit", detail, 2000)}
					onCreateClass={handleCreateClass}
				/>
			)}

			{/* Kept mounted (display toggles) so the chat history survives open/close. */}
			<AISidebar
				open={showAISidebar}
				onClose={() => setShowAISidebar(false)}
				caseId={String(caseId)}
				sessionId={sessionId}
				availableOrgans={aiAvailableOrgans}
				viewerState={{
					view: viewMode,
					opacity: opacityValue,
					windowWidth,
					windowCenter,
					zoomLevel,
				}}
				organMetrics={organStats ?? []}
				demographics={demographics}
				actions={aiActions}
			/>
			</div>

			{/* Local-DICOM load failure: explain and offer the way back. */}
			{dicomError && (
				<div className="vp-loading" role="alert">
					<div className="flex flex-col items-center gap-4" style={{ maxWidth: 420, textAlign: "center" }}>
						<div className="vp-loading__text">{dicomError}</div>
						<button className="vp-btn" onClick={() => { window.location.href = "/upload"; }}>
							Back to upload
						</button>
					</div>
				</div>
			)}

			{readingSession && (
				<SessionHUD
					session={readingSession}
					onSnapshot={() => { void takeSnapshot(); }}
					onStop={() => { void stopReadingSession(); }}
				/>
			)}

			{sessionResult && (
				<SessionSummary
					result={sessionResult}
					measurements={sessionMeasurements}
					onDiscard={() => setSessionResult(null)}
				/>
			)}

			{
				showReportScreen && (
					<ReportScreen
						id={caseId}
						onClose={() => {
							setShowReportScreen(false);
							handleClearIsolation();
							setViewMode("mpr");
						}}
						onOrganHighlight={handleOrganHighlight}
						onClearHighlight={handleClearIsolation}
						onHideOrgans={handleHideOrgans}
						onViewChange={(view) => setViewMode(view as ViewMode)}
					/>
				)
			}

		</div >
	);
}

export default VisualizationPage;
