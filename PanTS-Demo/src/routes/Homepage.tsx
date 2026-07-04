import {
	IconAdjustmentsHorizontal,
	IconArrowsShuffle,
	IconBookmark,
	IconChevronDown,
	IconDatabase,
	IconX,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Header from "../components/Header";
import Preview from "../components/Preview";
import { API_BASE } from "../helpers/constants";
import {
	buildSearchParams,
	countActiveFilters,
	EMPTY_FILTERS,
	itemToId,
	type MultiFilterKey,
	parseFiltersFromParams,
	type SearchFilters as Filters,
	type SearchItem,
	type TumorFilter,
} from "../helpers/search";
import { prefetchViewer } from "../helpers/prefetchViewer";
import {
	loadSavedCases,
	SAVED_CASES_EVENT,
	type SavedCase,
	toggleSavedCase,
} from "../helpers/savedCases";
import type { PreviewType } from "../types";

// Live facet counts from /api/facets (conditioned on the current filters).
type FacetRow = { value: string | number; count: number };
type FacetData = {
	counts: Record<string, FacetRow[]>;
	unknown: Record<string, number>;
	total: number;
};

// Filter groups whose available values are discovered from /api/facets (not hardcoded).
const FACET_GROUPS: { key: MultiFilterKey; field: string; title: string }[] = [
	{ key: "manufacturer", field: "manufacturer", title: "Manufacturer" },
	{ key: "ctPhase", field: "ct_phase", title: "CT Phase" },
	{ key: "siteNat", field: "site_nat", title: "Site" },
	{ key: "year", field: "year", title: "Study Year" },
];

// Number of cards in the curated landing strip (and skeleton placeholders).
const CARD_COUNT = 8;
// Page size when browsing/paging through search or filtered results.
// 4 columns × 4 rows = 16 cards per page.
const PER_PAGE = 16;

const TUMOR_OPTIONS: { value: TumorFilter; label: string }[] = [
	{ value: "any", label: "Any" },
	{ value: "tumor", label: "Tumor" },
	{ value: "no_tumor", label: "No tumor" },
];

// Values match the backend /api/search params: sex -> M/F/UNKNOWN, age -> age_bin[].
const SEX_OPTIONS = [
	{ value: "M", label: "Male" },
	{ value: "F", label: "Female" },
	{ value: "UNKNOWN", label: "Unknown" },
];

const AGE_OPTIONS = [
	{ value: "0-9", label: "0-9" },
	{ value: "10-19", label: "10-19" },
	{ value: "20-29", label: "20-29" },
	{ value: "30-39", label: "30-39" },
	{ value: "40-49", label: "40-49" },
	{ value: "50-59", label: "50-59" },
	{ value: "60-69", label: "60-69" },
	{ value: "70-79", label: "70-79" },
	{ value: "80-89", label: "80-89" },
	{ value: "90-99", label: "90-99" },
	{ value: "UNKNOWN", label: "Unknown" },
];

const pillStyle = (active: boolean): React.CSSProperties => ({
	padding: "7px 16px",
	borderRadius: "8px",
	fontFamily: "'Space Grotesk', sans-serif",
	fontSize: "13px",
	fontWeight: 600,
	cursor: "pointer",
	border: active ? "1px solid #002D72" : "1px solid rgba(0,0,0,0.08)",
	background: active ? "#002D72" : "rgba(0,0,0,0.04)",
	color: active ? "#ffffff" : "rgba(0,0,0,0.6)",
	transition: "all 0.15s",
	outline: "none",
});

const pagerBtnStyle = (disabled: boolean): React.CSSProperties => ({
	padding: "8px 16px",
	borderRadius: "8px",
	fontFamily: "'Space Grotesk', sans-serif",
	fontSize: "13px",
	fontWeight: 600,
	border: "1px solid rgba(0,0,0,0.12)",
	background: disabled ? "rgba(0,0,0,0.03)" : "#ffffff",
	color: disabled ? "rgba(0,0,0,0.25)" : "#111111",
	cursor: disabled ? "default" : "pointer",
	outline: "none",
});

const multiSelectTagStyle: React.CSSProperties = {
	fontFamily: "'JetBrains Mono', monospace",
	fontSize: "9px",
	fontWeight: 600,
	letterSpacing: "0.06em",
	textTransform: "uppercase",
	color: "rgba(0,0,0,0.4)",
	background: "rgba(0,0,0,0.05)",
	border: "1px solid rgba(0,0,0,0.08)",
	borderRadius: "5px",
	padding: "2px 7px",
};

const filterLabelStyle: React.CSSProperties = {
	fontFamily: "'Space Grotesk', sans-serif",
	fontSize: "12px",
	fontWeight: 700,
	letterSpacing: "0.04em",
	textTransform: "uppercase",
	color: "rgba(0,0,0,0.75)",
};

export default function Homepage() {
	const [PREVIEW_IDS, SET_PREVIEW_IDS] = useState<number[]>([]);
	const navigation = useNavigate();
	const [previewMetadata, setPreviewMetadata] = useState<{
		[key: string]: PreviewType;
	}>({});
	const [loading, setLoading] = useState(true);
	const [searchId, setSearchId] = useState<number>(0);
	const [searchParams, setSearchParams] = useSearchParams();
	const [showFilters, setShowFilters] = useState(false);
	const [filters, setFilters] = useState<Filters>(() => parseFiltersFromParams(searchParams));
	const [facetData, setFacetData] = useState<FacetData | null>(null);
	const [matchTotal, setMatchTotal] = useState<number | null>(null);
	const [copied, setCopied] = useState(false);
	const [page, setPage] = useState(1);
	const [pageInput, setPageInput] = useState("");
	const [resultCount, setResultCount] = useState<number | null>(null);

	// Bookmarked cases (localStorage). `showSaved` swaps the grid to show only these.
	const [savedCases, setSavedCases] = useState<SavedCase[]>(loadSavedCases);
	const [showSaved, setShowSaved] = useState(false);
	const savedIds = new Set(savedCases.map((c) => c.id));

	// Keep in sync when a bookmark is toggled here or in another tab.
	useEffect(() => {
		const refresh = () => setSavedCases(loadSavedCases());
		window.addEventListener(SAVED_CASES_EVENT, refresh);
		window.addEventListener("storage", refresh);
		return () => {
			window.removeEventListener(SAVED_CASES_EVENT, refresh);
			window.removeEventListener("storage", refresh);
		};
	}, []);

	const handleToggleSave = (id: number, meta?: PreviewType) => {
		const m = meta ?? previewMetadata[id];
		toggleSavedCase({ id, sex: m?.sex ?? "", age: m?.age ?? 0, tumor: m?.tumor ?? 0 });
	};

	// Cases picked for side-by-side comparison (max 2). Adding a third drops the oldest,
	// so the two most recent picks are always what get compared.
	const [compareIds, setCompareIds] = useState<number[]>([]);
	const [compareTyped, setCompareTyped] = useState("");
	const toggleCompare = (id: number) => {
		setCompareIds((prev) =>
			prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-2)
		);
	};
	// Add a case by id typed into the tray (idempotent; caps at the two most recent).
	const addCompareId = (id: number) => {
		setCompareIds((prev) => (prev.includes(id) ? prev : [...prev, id].slice(-2)));
	};
	const submitTypedCompare = () => {
		const n = parseInt(compareTyped.trim(), 10);
		if (Number.isFinite(n) && n > 0) addCompareId(n);
		setCompareTyped("");
	};

	// Turn /api/search (or /api/random) items into the ids + metadata the grid needs.
	const ingestItems = (items: SearchItem[]) => {
		const ids: number[] = [];
		const meta: { [key: string]: PreviewType } = {};
		for (const it of items) {
			const id = itemToId(it);
			if (!id) continue;
			ids.push(id);
			meta[id] = {
				sex: it.sex ?? "",
				age: Number(it.age) || 0,
				tumor: it.tumor === 1 ? 1 : 0,
			};
		}
		setPreviewMetadata(meta);
		SET_PREVIEW_IDS(ids);
		setLoading(false);
	};

	// Curated cases = the fullest-body scans (sort_by=shape_desc = largest image
	// dimensions / most anatomy covered), split half tumor / half no-tumor and
	// interleaved so the grid is balanced. Uses the existing /api/search endpoint
	// with its built-in sort — no hardcoded ids.
	const loadCurated = async () => {
		setLoading(true);
		setPreviewMetadata({});
		const half = CARD_COUNT / 2;
		try {
			const [tumorRes, noTumorRes] = await Promise.all([
				fetch(`${API_BASE}/api/search?tumor=1&sort_by=shape_desc&per_page=${half}`).then((r) => r.json()),
				fetch(`${API_BASE}/api/search?tumor=0&sort_by=shape_desc&per_page=${half}`).then((r) => r.json()),
			]);
			const tumorItems: SearchItem[] = tumorRes.items ?? [];
			const noTumorItems: SearchItem[] = noTumorRes.items ?? [];
			const interleaved: SearchItem[] = [];
			for (let i = 0; i < Math.max(tumorItems.length, noTumorItems.length); i++) {
				if (tumorItems[i]) interleaved.push(tumorItems[i]);
				if (noTumorItems[i]) interleaved.push(noTumorItems[i]);
			}
			ingestItems(interleaved);
		} catch (e) {
			console.error(e);
			setLoading(false);
		}
	};

	// Run /api/search for the given filters + page and populate the grid. The matched
	// cohort can be any size (up to the full ~9.9k), but we only ever fetch/render one
	// PER_PAGE page at a time, so the DOM/thumbnail load stays bounded.
	const runSearch = async (f: Filters, p = 1) => {
		setLoading(true);
		setPreviewMetadata({});
		try {
			const params = buildSearchParams(f, { sortBy: "quality", perPage: PER_PAGE });
			params.set("page", String(p));
			const res = await fetch(`${API_BASE}/api/search?${params.toString()}`);
			const data = await res.json();
			setResultCount(data.total ?? 0);
			setPage(data.page ?? p);
			ingestItems(data.items ?? []);
		} catch (e) {
			console.error(e);
			setLoading(false);
		}
	};

	// Jump to a page of the current cohort and scroll the grid back into view.
	const goToPage = (p: number) => {
		const pages = resultCount ? Math.max(1, Math.ceil(resultCount / PER_PAGE)) : 1;
		const next = Math.min(Math.max(1, p), pages);
		runSearch(filters, next);
		window.scrollTo({ top: 0, behavior: "smooth" });
	};

	// Facet OPTION lists + baseline counts — fetched once, UNFILTERED, so the available
	// pills and the numbers on them stay stable (picking one filter never hides or
	// re-counts the others). Only the bottom "cases match" total reacts to the filters.
	const loadFacetOptions = async () => {
		try {
			const params = new URLSearchParams();
			params.set("fields", "tumor,sex,manufacturer,ct_phase,site_nat,year");
			params.set("top_k", "8");
			const res = await fetch(`${API_BASE}/api/facets?${params.toString()}`);
			const data = await res.json();
			setFacetData({
				counts: data.facets ?? {},
				unknown: data.unknown_counts ?? {},
				total: data.total ?? 0,
			});
		} catch (e) {
			console.error(e);
		}
	};

	// Live count of cases matching the current draft filters (shown only at the bottom).
	const loadMatchTotal = async (f: Filters) => {
		try {
			const params = buildSearchParams(f, { perPage: 1 });
			const res = await fetch(`${API_BASE}/api/search?${params.toString()}`);
			const data = await res.json();
			setMatchTotal(data.total ?? 0);
		} catch (e) {
			console.error(e);
		}
	};

	// On mount: if the URL carries filters (a shared/bookmarked cohort), restore and run
	// them; otherwise show the curated grid.
	useEffect(() => {
		const urlFilters = parseFiltersFromParams(searchParams);
		if (countActiveFilters(urlFilters) > 0) {
			setShowFilters(true);
			runSearch(urlFilters);
		} else {
			loadCurated();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Fetch the (static, unfiltered) option lists the first time the panel opens.
	useEffect(() => {
		if (showFilters && !facetData) loadFacetOptions();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [showFilters]);

	// Update only the bottom "cases match" total as the draft filters change (debounced).
	useEffect(() => {
		if (!showFilters) return;
		const t = setTimeout(() => loadMatchTotal(filters), 200);
		return () => clearTimeout(t);
	}, [filters, showFilters]);

	// Warm the code-split viewer chunk once the dashboard is idle, so the first
	// case-open is instant even when navigating via the case-ID search (no hover).
	useEffect(() => {
		const ric = (window as unknown as {
			requestIdleCallback?: (cb: () => void) => number;
		}).requestIdleCallback;
		const id = ric ? ric(() => prefetchViewer()) : window.setTimeout(prefetchViewer, 1500);
		return () => {
			if (!ric) window.clearTimeout(id as number);
		};
	}, []);

	const handleShuffle = async () => {
		setLoading(true);
		setPreviewMetadata({});
		setResultCount(null);
		setPage(1);
		setFilters(EMPTY_FILTERS); // shuffle is a fresh unfiltered draw — clear any active advanced-search filters
		setSearchParams({}); // drop filters from the URL
		try {
			const res = await fetch(
				`${API_BASE}/api/random?n=${CARD_COUNT}&k=120&scope=all`
			);
			const data = await res.json();
			ingestItems(data.items ?? []);
		} catch (e) {
			console.error(e);
			setLoading(false);
		}
	};

	// Browse the entire dataset, paginated (no filters) — a one-click path to "see
	// everything" that still only loads one page at a time.
	const handleBrowseAll = () => {
		setFilters(EMPTY_FILTERS);
		setSearchParams({});
		runSearch(EMPTY_FILTERS, 1);
	};

	const activeFilterCount = countActiveFilters(filters);

	const toggleMulti = (key: MultiFilterKey, value: string) => {
		setFilters((f) => {
			const has = f[key].includes(value);
			return {
				...f,
				[key]: has ? f[key].filter((v) => v !== value) : [...f[key], value],
			};
		});
	};

	// Count for a given facet value (e.g. how many cases match Sex=M given the other
	// active filters). null when facets haven't loaded yet.
	const facetCount = (field: string, value: string | number): number | null => {
		const rows = facetData?.counts[field];
		if (!rows) return null;
		const row = rows.find((r) => String(r.value) === String(value));
		return row ? row.count : 0;
	};

	// Small mono count shown inside a pill, e.g. "Male 4,210".
	const countBadge = (count: number | null) =>
		count == null ? null : (
			<span
				style={{
					marginLeft: "7px",
					fontFamily: "'JetBrains Mono', monospace",
					fontSize: "10px",
					opacity: 0.6,
				}}
			>
				{count.toLocaleString()}
			</span>
		);

	const handleApplyFilters = () => {
		// Encode the cohort into the URL so it's shareable/bookmarkable, then load it.
		setSearchParams(buildSearchParams(filters));
		runSearch(filters, 1);
		setShowFilters(false); // collapse the advanced-filters panel after applying
	};

	const handleResetFilters = () => {
		setFilters(EMPTY_FILTERS);
		setResultCount(null);
		setPage(1);
		setSearchParams({});
		loadCurated();
	};

	// Copy a shareable link to the current (draft) cohort so it can be sent/bookmarked.
	const handleCopyLink = async () => {
		const qs = buildSearchParams(filters).toString();
		const url = `${window.location.origin}${window.location.pathname}${qs ? `?${qs}` : ""}`;
		try {
			await navigator.clipboard.writeText(url);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard API unavailable (e.g. non-secure context) — fall back to a prompt.
			window.prompt("Copy this link:", url);
		}
	};

	return (
		<div
			className="min-h-screen text-black relative overflow-x-hidden"
			style={{ background: "#ffffff" }}
		>
			{/* Ambient background orbs */}
			<div
				className="pointer-events-none fixed inset-0 overflow-hidden"
				aria-hidden="true"
			>
				<div
					className="absolute rounded-full"
					style={{
						top: "-160px",
						left: "-160px",
						width: "700px",
						height: "700px",
						background: "radial-gradient(circle, rgba(0,0,0,0.04) 0%, transparent 70%)",
						filter: "blur(40px)",
					}}
				/>
				<div
					className="absolute rounded-full"
					style={{
						top: "35%",
						right: "-192px",
						width: "600px",
						height: "600px",
						background: "radial-gradient(circle, rgba(0,0,0,0.03) 0%, transparent 70%)",
						filter: "blur(40px)",
					}}
				/>
				<div
					className="absolute rounded-full"
					style={{
						bottom: "80px",
						left: "33%",
						width: "500px",
						height: "400px",
						background: "radial-gradient(circle, rgba(0,0,0,0.025) 0%, transparent 70%)",
						filter: "blur(40px)",
					}}
				/>
			</div>

			<Header />

			{/* Case library */}
			<section className="mx-auto max-w-6xl px-6 pt-8 pb-16">
				<div
					style={{
						background: "#f5f5f5",
						border: "1px solid rgba(0,0,0,0.06)",
						borderRadius: "16px",
						padding: "24px 32px",
						marginBottom: "24px",
					}}
				>
					{/* Section header */}
					<div
						style={{
							fontFamily: "'Space Grotesk', sans-serif",
							fontSize: "11px",
							fontWeight: 600,
							letterSpacing: "0.12em",
							textTransform: "uppercase",
							color: "#8f8f8f",
							marginBottom: "20px",
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center"
						}}
					>
						<span>Browse Library</span>
						<div className="flex items-center gap-5">
							<button
								className="flex items-center gap-1.5 transition-all duration-200"
								style={{
									fontSize: "11px",
									color: "rgba(0,0,0,0.45)",
									background: "transparent",
									border: "none",
									cursor: "pointer",
									textTransform: "none",
									letterSpacing: "0.04em",
									fontFamily: "'JetBrains Mono', monospace",
								}}
								onMouseEnter={(e) => {
									(e.currentTarget as HTMLElement).style.color = "rgba(0,0,0,0.85)";
								}}
								onMouseLeave={(e) => {
									(e.currentTarget as HTMLElement).style.color = "rgba(0,0,0,0.45)";
								}}
								onClick={handleBrowseAll}
							>
								<IconDatabase size={14} />
								Browse all
							</button>
							<button
								className="flex items-center gap-1.5 transition-all duration-200"
								style={{
									fontSize: "11px",
									color: "rgba(0,0,0,0.45)",
									background: "transparent",
									border: "none",
									cursor: "pointer",
									textTransform: "none",
									letterSpacing: "0.04em",
									fontFamily: "'JetBrains Mono', monospace",
								}}
								onMouseEnter={(e) => {
									(e.currentTarget as HTMLElement).style.color = "rgba(0,0,0,0.85)";
								}}
								onMouseLeave={(e) => {
									(e.currentTarget as HTMLElement).style.color = "rgba(0,0,0,0.45)";
								}}
								onClick={handleShuffle}
							>
								<IconArrowsShuffle size={14} />
								Shuffle Cases
							</button>
							<button
								className="flex items-center gap-1.5 transition-all duration-200"
								style={{
									fontSize: "11px",
									color: showSaved ? "rgba(0,0,0,0.85)" : "rgba(0,0,0,0.45)",
									background: "transparent",
									border: "none",
									cursor: "pointer",
									textTransform: "none",
									letterSpacing: "0.04em",
									fontFamily: "'JetBrains Mono', monospace",
								}}
								onMouseEnter={(e) => {
									(e.currentTarget as HTMLElement).style.color = "rgba(0,0,0,0.85)";
								}}
								onMouseLeave={(e) => {
									(e.currentTarget as HTMLElement).style.color = showSaved
										? "rgba(0,0,0,0.85)"
										: "rgba(0,0,0,0.45)";
								}}
								onClick={() => setShowSaved((v) => !v)}
							>
								<IconBookmark size={14} />
								{showSaved ? "Back to browse" : `Saved${savedCases.length ? ` (${savedCases.length})` : ""}`}
							</button>
						</div>
					</div>

					{/* Case search */}
					<div className="flex gap-3">
						<input
							type="text"
							placeholder="Search by case ID, e.g. 17, 35, 121"
							style={{
								flex: 1,
								padding: "10px 16px",
								background: "rgba(0,0,0,.04)",
								border: "1px solid rgba(0,0,0,.08)",
								borderRadius: "8px",
								color: "#111111",
								fontFamily: "'Space Grotesk', sans-serif",
								fontSize: "13px",
								outline: "none",
							}}
							value={searchId || ""}
							onChange={(e) => {
								const val = e.target.value;
								// Allow numbers only or empty
								if (val === "" || /^\d+$/.test(val)) {
									setSearchId(val ? Number(val) : 0);
								}
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter" && searchId) {
									const clamped = Math.max(1, Math.min(9901, searchId));
									navigation("/case/" + clamped);
								}
							}}
						/>

						<button
							onClick={() => setShowFilters((v) => !v)}
							style={{
								flex: 1,
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								padding: "10px 16px",
								background: showFilters ? "rgba(0,0,0,.07)" : "rgba(0,0,0,.04)",
								border: "1px solid rgba(0,0,0,.08)",
								borderRadius: "8px",
								color: "#6a6a6a",
								fontFamily: "'Space Grotesk', sans-serif",
								fontSize: "13px",
								outline: "none",
								cursor: "pointer",
							}}
						>
							<span className="flex items-center gap-2">
								<IconAdjustmentsHorizontal size={15} />
								Advanced filters
								{activeFilterCount > 0 && (
									<span
										style={{
											background: "#002D72",
											color: "#ffffff",
											fontSize: "10px",
											fontWeight: 700,
											borderRadius: "999px",
											minWidth: "16px",
											height: "16px",
											display: "inline-flex",
											alignItems: "center",
											justifyContent: "center",
											padding: "0 5px",
										}}
									>
										{activeFilterCount}
									</span>
								)}
							</span>
							<IconChevronDown
								size={15}
								style={{
									transform: showFilters ? "rotate(180deg)" : "none",
									transition: "transform 0.2s",
								}}
							/>
						</button>

						<button
							style={{
								padding: "10px 32px",
								background: "#002D72",
								border: "none",
								borderRadius: "8px",
								color: "#ffffff",
								fontFamily: "'Space Grotesk', sans-serif",
								fontSize: "13px",
								fontWeight: 600,
								cursor: "pointer",
							}}
							onClick={() => {
								if (searchId) {
									const clamped = Math.max(1, Math.min(9901, searchId));
									navigation("/case/" + clamped);
								}
							}}
						>
							Search
						</button>
					</div>

					{/* Advanced search panel */}
					{showFilters && (
						<div
							style={{
								marginTop: "16px",
								paddingTop: "20px",
								borderTop: "1px solid rgba(0,0,0,0.07)",
								display: "flex",
								flexDirection: "column",
								gap: "20px",
							}}
						>
							{/* Tumor */}
							<div className="flex flex-col gap-2.5">
								<span style={filterLabelStyle}>Tumor</span>
								<div className="flex flex-wrap gap-2">
									{TUMOR_OPTIONS.map((opt) => (
										<button
											key={opt.value}
											style={pillStyle(filters.tumor === opt.value)}
											onClick={() =>
												setFilters((f) => ({ ...f, tumor: opt.value }))
											}
										>
											{opt.label}
											{countBadge(opt.value === "tumor" ? facetCount("tumor", 1) : opt.value === "no_tumor" ? facetCount("tumor", 0) : null)}
										</button>
									))}
								</div>
							</div>

							{/* Sex */}
							<div className="flex flex-col gap-2.5">
								<span className="flex items-center gap-2">
									<span style={filterLabelStyle}>Sex</span>
									<span style={multiSelectTagStyle}>Multi-Select</span>
								</span>
								<div className="flex flex-wrap gap-2">
									<button
										style={pillStyle(filters.sex.length === 0)}
										onClick={() => setFilters((f) => ({ ...f, sex: [] }))}
									>
										Any
									</button>
									{SEX_OPTIONS.map((opt) => (
										<button
											key={opt.value}
											style={pillStyle(filters.sex.includes(opt.value))}
											onClick={() => toggleMulti("sex", opt.value)}
										>
											{opt.label}
											{countBadge(opt.value === "UNKNOWN" ? (facetData?.unknown.sex ?? null) : facetCount("sex", opt.value))}
										</button>
									))}
								</div>
							</div>

							{/* Age */}
							<div className="flex flex-col gap-2.5">
								<span className="flex items-center gap-2">
									<span style={filterLabelStyle}>Age</span>
									<span style={multiSelectTagStyle}>Multi-Select</span>
								</span>
								<div className="flex flex-wrap gap-2">
									<button
										style={pillStyle(filters.age.length === 0)}
										onClick={() => setFilters((f) => ({ ...f, age: [] }))}
									>
										Any
									</button>
									{AGE_OPTIONS.map((opt) => (
										<button
											key={opt.value}
											style={pillStyle(filters.age.includes(opt.value))}
											onClick={() => toggleMulti("age", opt.value)}
										>
											{opt.label}
										</button>
									))}
								</div>
							</div>

							{/* Metadata facets — manufacturer / CT phase / site / year; values + live counts from /api/facets */}
							{FACET_GROUPS.map((g) => {
								const rows = facetData?.counts[g.field] ?? [];
								const selected = filters[g.key];
								return (
									<div key={g.key} className="flex flex-col gap-2.5">
										<span className="flex items-center gap-2">
											<span style={filterLabelStyle}>{g.title}</span>
											<span style={multiSelectTagStyle}>Multi-Select</span>
										</span>
										<div className="flex flex-wrap gap-2">
											<button
												style={pillStyle(selected.length === 0)}
												onClick={() => setFilters((f) => ({ ...f, [g.key]: [] }))}
											>
												Any
											</button>
											{rows.length === 0 ? (
												<span style={{ alignSelf: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", color: "rgba(0,0,0,0.35)" }}>
													{facetData ? "—" : "Loading…"}
												</span>
											) : (
												rows.map((r) => {
													const val = String(r.value);
													return (
														<button
															key={val}
															style={pillStyle(selected.includes(val))}
															onClick={() => toggleMulti(g.key, val)}
														>
															{val}
															{countBadge(r.count)}
														</button>
													);
												})
											)}
										</div>
									</div>
								);
})}

							{/* Footer actions */}
							<div
								className="flex items-center justify-between"
								style={{
									paddingTop: "16px",
									borderTop: "1px solid rgba(0,0,0,0.07)",
								}}
							>
								<span
									style={{
										fontFamily: "'JetBrains Mono', monospace",
										fontSize: "11px",
										color: "rgba(0,0,0,0.45)",
									}}
								>
									{matchTotal !== null
										? `${matchTotal.toLocaleString()} ${
												matchTotal === 1 ? "case matches" : "cases match"
										  }`
										: "Filter by tumor, sex, age, manufacturer, phase, site & year"}
								</span>
								<div className="flex items-center gap-2">
									<button
										onClick={handleCopyLink}
										style={{
											padding: "9px 18px",
											background: "transparent",
											border: "1px solid rgba(0,0,0,0.12)",
											borderRadius: "8px",
											color: copied ? "#10b981" : "rgba(0,0,0,0.6)",
											fontFamily: "'Space Grotesk', sans-serif",
											fontSize: "13px",
											fontWeight: 600,
											cursor: "pointer",
											transition: "color 0.15s",
										}}
									>
										{copied ? "Link copied!" : "Copy link"}
									</button>
									<button
										onClick={handleResetFilters}
										style={{
											padding: "9px 18px",
											background: "transparent",
											border: "1px solid rgba(0,0,0,0.12)",
											borderRadius: "8px",
											color: "rgba(0,0,0,0.6)",
											fontFamily: "'Space Grotesk', sans-serif",
											fontSize: "13px",
											fontWeight: 600,
											cursor: "pointer",
										}}
									>
										Reset
									</button>
									<button
										onClick={handleApplyFilters}
										style={{
											padding: "9px 24px",
											background: "#002D72",
											border: "none",
											borderRadius: "8px",
											color: "#ffffff",
											fontFamily: "'Space Grotesk', sans-serif",
											fontSize: "13px",
											fontWeight: 600,
											cursor: "pointer",
										}}
									>
										Apply filters
									</button>
								</div>
							</div>
						</div>
					)}
				</div>

				{/* Results summary */}
				{!showSaved && resultCount !== null && (
					<div
						className="flex items-center justify-between"
						style={{ marginBottom: "16px", padding: "0 4px" }}
					>
						<span
							style={{
								fontFamily: "'JetBrains Mono', monospace",
								fontSize: "12px",
								color: "rgba(0,0,0,0.55)",
							}}
						>
							{resultCount === 0
								? "No cases match these filters"
								: `${resultCount.toLocaleString()} ${
										resultCount === 1 ? "result" : "results"
								  } · page ${page} of ${Math.max(1, Math.ceil(resultCount / PER_PAGE)).toLocaleString()}`}
						</span>
						<button
							onClick={handleResetFilters}
							className="flex items-center gap-1.5"
							style={{
								fontFamily: "'JetBrains Mono', monospace",
								fontSize: "12px",
								color: "rgba(0,0,0,0.45)",
								background: "transparent",
								border: "none",
								cursor: "pointer",
							}}
						>
							<IconX size={13} />
							Clear filters
						</button>
					</div>
				)}

				{/* Grid */}
				{showSaved && savedCases.length === 0 ? (
					<div
						style={{
							padding: "48px 0",
							textAlign: "center",
							fontFamily: "'JetBrains Mono', monospace",
							fontSize: "13px",
							color: "rgba(0,0,0,0.5)",
						}}
					>
						No saved cases yet — click the bookmark on any case to save it here.
					</div>
				) : (
					<div className="grid gap-4" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
						{showSaved
							? savedCases.map((c) => (
									<Preview
										key={c.id}
										id={c.id}
										previewMetadata={{ sex: c.sex, age: c.age, tumor: c.tumor }}
										saved
										onToggleSave={() =>
											handleToggleSave(c.id, { sex: c.sex, age: c.age, tumor: c.tumor })
										}
										compareSelected={compareIds.includes(c.id)}
										onToggleCompare={() => toggleCompare(c.id)}
									/>
								))
							: loading
								? Array.from({ length: resultCount !== null ? PER_PAGE : CARD_COUNT }).map((_, i) => (
										<div
											key={i}
											className="bm-card-skeleton rounded-xl"
											style={{ aspectRatio: "3/4" }}
										/>
									))
								: PREVIEW_IDS.map((id) => (
										<Preview
											key={id}
											id={id}
											previewMetadata={previewMetadata[id]}
											saved={savedIds.has(id)}
											onToggleSave={() => handleToggleSave(id)}
											compareSelected={compareIds.includes(id)}
											onToggleCompare={() => toggleCompare(id)}
										/>
									))}
					</div>
				)}
				
				{/* Page navigation over the current cohort — only one page is ever in the DOM. */}
				{!showSaved &&
					resultCount !== null &&
					resultCount > PER_PAGE &&
					(() => {
						const pages = Math.max(1, Math.ceil(resultCount / PER_PAGE));
						return (
							<div className="flex items-center justify-center gap-4" style={{ marginTop: "28px" }}>
								<button style={pagerBtnStyle(page <= 1)} disabled={page <= 1} onClick={() => goToPage(page - 1)}>
									‹ Prev
								</button>
								<span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "12px", color: "rgba(0,0,0,0.55)", minWidth: "120px", textAlign: "center" }}>
									Page {page.toLocaleString()} of {pages.toLocaleString()}
								</span>
								<button style={pagerBtnStyle(page >= pages)} disabled={page >= pages} onClick={() => goToPage(page + 1)}>
									Next ›
								</button>
								<form
									className="flex items-center gap-2"
									style={{ marginLeft: "8px" }}
									onSubmit={(e) => {
										e.preventDefault();
										const n = parseInt(pageInput, 10);
										if (!Number.isNaN(n)) {
											goToPage(n); // goToPage clamps to [1, pages]
											setPageInput("");
										}
									}}
								>
									<input
										type="number"
										min={1}
										max={pages}
										value={pageInput}
										onChange={(e) => setPageInput(e.target.value)}
										placeholder={`Go to… (1–${pages})`}
										aria-label="Go to page"
										style={{
											width: "132px",
											padding: "8px 10px",
											borderRadius: "8px",
											border: "1px solid rgba(0,0,0,0.12)",
											fontFamily: "'JetBrains Mono', monospace",
											fontSize: "12px",
											color: "#111111",
											background: "#ffffff",
											outline: "none",
										}}
									/>
									<button type="submit" disabled={pageInput.trim() === ""} style={pagerBtnStyle(pageInput.trim() === "")}>
										Go
									</button>
								</form>
							</div>
						);
					})()}
			</section>

			{/* Floating comparison tray — appears once a case is picked via the compare button
			    on a card; links to the /compare view when two are selected. */}
			{compareIds.length > 0 && (
				<div
					style={{
						position: "fixed",
						bottom: "24px",
						left: "50%",
						transform: "translateX(-50%)",
						zIndex: 60,
						display: "flex",
						alignItems: "center",
						gap: "14px",
						background: "rgba(14,15,18,0.94)",
						backdropFilter: "blur(12px)",
						border: "1px solid rgba(255,255,255,0.14)",
						borderRadius: "12px",
						padding: "10px 14px",
						boxShadow: "0 16px 40px -12px rgba(0,0,0,0.6)",
						color: "#fff",
						fontSize: "13px",
					}}
				>
					<span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "12px" }}>
						{compareIds.map((id) => `#${id}`).join("  vs  ")}
					</span>
					{compareIds.length < 2 && (
						<form
							onSubmit={(e) => {
								e.preventDefault();
								submitTypedCompare();
							}}
							style={{ display: "flex", alignItems: "center", gap: "6px" }}
						>
							<input
								value={compareTyped}
								onChange={(e) => setCompareTyped(e.target.value.replace(/[^0-9]/g, ""))}
								placeholder="type case #"
								inputMode="numeric"
								aria-label="Add a case by number"
								style={{
									width: "96px",
									padding: "5px 8px",
									borderRadius: "8px",
									border: "1px solid rgba(255,255,255,0.2)",
									background: "rgba(255,255,255,0.06)",
									color: "#fff",
									fontFamily: "'JetBrains Mono', monospace",
									fontSize: "12px",
								}}
							/>
							<button
								type="submit"
								disabled={compareTyped.trim() === ""}
								style={{
									background: "transparent",
									border: "1px solid rgba(255,255,255,0.2)",
									color: "#fff",
									borderRadius: "8px",
									padding: "5px 10px",
									cursor: compareTyped.trim() === "" ? "not-allowed" : "pointer",
									fontSize: "12px",
									opacity: compareTyped.trim() === "" ? 0.5 : 1,
								}}
							>
								Add
							</button>
						</form>
					)}
					<button
						onClick={() => setCompareIds([])}
						style={{
							background: "transparent",
							border: "1px solid rgba(255,255,255,0.2)",
							color: "#fff",
							borderRadius: "8px",
							padding: "5px 10px",
							cursor: "pointer",
							fontSize: "12px",
						}}
					>
						Clear
					</button>
					<button
						disabled={compareIds.length < 2}
						onClick={() => navigation(`/compare?a=${compareIds[0]}&b=${compareIds[1]}`)}
						style={{
							background: compareIds.length < 2 ? "rgba(37,99,235,0.4)" : "#2563eb",
							border: "none",
							color: "#fff",
							borderRadius: "8px",
							padding: "5px 12px",
							cursor: compareIds.length < 2 ? "not-allowed" : "pointer",
							fontSize: "12px",
							fontWeight: 600,
						}}
					>
						Compare →
					</button>
				</div>
			)}
		</div>
	);
}
