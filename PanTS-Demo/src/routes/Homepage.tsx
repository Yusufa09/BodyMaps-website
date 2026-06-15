import {
	IconAdjustmentsHorizontal,
	IconArrowsShuffle,
	IconAtom,
	IconBuildingHospital,
	IconChevronDown,
	IconDatabase,
	IconStack2,
	IconX,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import Preview from "../components/Preview";
import { API_BASE } from "../helpers/constants";
import type { PreviewType } from "../types";

// Number of cards shown on the dashboard (and skeleton placeholders).
const CARD_COUNT = 8;

const STATS = [
	{ label: "CT Volumes", value: "36,390", icon: IconDatabase },
	{ label: "Medical Centers", value: "145", icon: IconBuildingHospital },
	{ label: "Annotated Structures", value: "993K+", icon: IconStack2 },
	{ label: "Organ Classes", value: "25", icon: IconAtom },
];

type TumorFilter = "any" | "tumor" | "no_tumor";

type Filters = {
	tumor: TumorFilter;
	sex: string[];
	age: string[];
};

const DEFAULT_FILTERS: Filters = { tumor: "any", sex: [], age: [] };

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

// Minimal shape of an item returned by /api/search and /api/random.
type SearchItem = {
	case_id?: string | number;
	"PanTS ID"?: string | number;
	id?: string | number;
	tumor?: number | null;
	sex?: string | null;
	age?: number | string | null;
};

const itemToId = (it: SearchItem): number => {
	const raw = String(it.case_id ?? it["PanTS ID"] ?? it.id ?? "");
	const m = raw.match(/\d+/);
	return m ? Number(m[0]) : 0;
};

const pillStyle = (active: boolean): React.CSSProperties => ({
	padding: "7px 16px",
	borderRadius: "8px",
	fontFamily: "'Space Grotesk', sans-serif",
	fontSize: "13px",
	fontWeight: 600,
	cursor: "pointer",
	border: active ? "1px solid #111111" : "1px solid rgba(0,0,0,0.08)",
	background: active ? "#111111" : "rgba(0,0,0,0.04)",
	color: active ? "#ffffff" : "rgba(0,0,0,0.6)",
	transition: "all 0.15s",
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
	const [showFilters, setShowFilters] = useState(false);
	const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
	const [resultCount, setResultCount] = useState<number | null>(null);

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

	// Curated cases = the lab's own "quality" ranking (most complete + deepest
	// coverage), split 4 tumor / 4 no-tumor and interleaved so no grid row is all
	// one class. Uses the existing /api/search endpoint — no hardcoded ids.
	const loadCurated = async () => {
		setLoading(true);
		setPreviewMetadata({});
		const half = CARD_COUNT / 2;
		try {
			const [tumorRes, noTumorRes] = await Promise.all([
				fetch(`${API_BASE}/api/search?tumor=1&sort_by=quality&per_page=${half}`).then((r) => r.json()),
				fetch(`${API_BASE}/api/search?tumor=0&sort_by=quality&per_page=${half}`).then((r) => r.json()),
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

	useEffect(() => {
		loadCurated();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const handleShuffle = async () => {
		setLoading(true);
		setPreviewMetadata({});
		setResultCount(null);
		setFilters(DEFAULT_FILTERS); // shuffle is a fresh unfiltered draw — clear any active advanced-search filters
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

	const activeFilterCount =
		(filters.tumor !== "any" ? 1 : 0) + filters.sex.length + filters.age.length;

	const toggleMulti = (key: "sex" | "age", value: string) => {
		setFilters((f) => {
			const has = f[key].includes(value);
			return {
				...f,
				[key]: has ? f[key].filter((v) => v !== value) : [...f[key], value],
			};
		});
	};

	const handleApplyFilters = async () => {
		setLoading(true);
		setPreviewMetadata({});
		try {
			const params = new URLSearchParams();
			filters.sex.forEach((v) => params.append("sex[]", v));
			if (filters.tumor === "tumor") params.set("tumor", "1");
			else if (filters.tumor === "no_tumor") params.set("tumor", "0");
			filters.age.forEach((v) => params.append("age_bin[]", v));
			params.set("sort_by", "quality");
			params.set("per_page", "12");
			const res = await fetch(`${API_BASE}/api/search?${params.toString()}`);
			const data = await res.json();
			setResultCount(data.total ?? 0);
			const items: SearchItem[] = data.items ?? [];
			if (items.length) {
				ingestItems(items);
			} else {
				setPreviewMetadata({});
				SET_PREVIEW_IDS([]);
				setLoading(false);
			}
		} catch (e) {
			console.error(e);
			setLoading(false);
		}
	};

	const handleResetFilters = () => {
		setFilters(DEFAULT_FILTERS);
		setResultCount(null);
		loadCurated();
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

			{/* Stats bar */}
			<div
				style={{
					borderBottom: "1px solid rgba(0,0,0,0.05)",
				}}
			>
				<div className="mx-auto max-w-6xl grid grid-cols-4 px-6">
					{STATS.map(({ label, value }, i) => (
						<div
							key={label}
							className="flex flex-col px-8 py-5"
							style={{
								borderLeft: i > 0 ? "1px solid rgba(0,0,0,0.07)" : "none",
							}}
						>
							<div
								className="font-bold tabular-nums text-black leading-none"
								style={{ fontSize: "28px", letterSpacing: "-0.02em" }}
							>
								{value}
							</div>
							<div
								className="font-medium mt-2"
								style={{
									fontFamily: "'JetBrains Mono', monospace",
									fontSize: "10px",
									color: "rgba(0,0,0,0.35)",
									letterSpacing: "0.14em",
									textTransform: "uppercase",
								}}
							>
								{label}
							</div>
						</div>
					))}
				</div>
			</div>

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
											background: "#111111",
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
								background: "#000000",
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
									{resultCount !== null
										? `${resultCount.toLocaleString()} ${
												resultCount === 1 ? "case matches" : "cases match"
										  }`
										: "Filter the dataset by tumor, sex & age"}
								</span>
								<div className="flex items-center gap-2">
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
											background: "#000000",
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
				{resultCount !== null && (
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
										resultCount === 1 ? "match" : "matches"
								  } · showing ${Math.min(resultCount, PREVIEW_IDS.length)}`}
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
				<div className="grid gap-4"
					style={{ gridTemplateColumns: "repeat(4, 1fr)" }}
				>
					{loading
						? Array.from({ length: CARD_COUNT }).map((_, i) => (
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
								/>
							))}
				</div>
			</section>
		</div>
	);
}
