// Side-by-side comparison of two dataset cases: previews + demographics + an aligned
// organ-stats table with per-organ volume/percentile deltas. Reuses the same
// computeStatRows + population-norms pipeline as the viewer's Organ Statistics panel, so
// the numbers match. Data-only (no WebGL), so it loads fast and works without the viewer.
// The two case ids live in the URL (?a=&b=) → the whole comparison is shareable.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { alignStatRows } from "../helpers/compareStats";
import { API_BASE } from "../helpers/constants";
import { loadOrganNorms, type OrganNorms } from "../helpers/organNorms";
import { computeStatRows, type OrganMetric } from "../helpers/organStatsExport";
import "./ComparePage.css";

type Demographics = { sex: string | null; age: number | null; tumor: number | null };
type CaseData = {
	loading: boolean;
	error: boolean;
	demographics: Demographics | null;
	metrics: OrganMetric[] | null;
};
const EMPTY: CaseData = { loading: false, error: false, demographics: null, metrics: null };

// Load one case's demographics (from the existing /api/search) + organ metrics (from
// /api/mask-data). Both degrade independently. The dev seed short-circuits to synthetic
// data so the page is demoable without the dataset.
function useCaseData(id: string): CaseData {
	const [state, setState] = useState<CaseData>(EMPTY);
	useEffect(() => {
		const trimmed = id.trim();
		if (!trimmed) {
			setState(EMPTY);
			return;
		}
		let cancelled = false;
		setState({ ...EMPTY, loading: true });
		(async () => {
			let demographics: Demographics | null = null;
			let metrics: OrganMetric[] | null = null;
			let error = false;
			try {
				const res = await fetch(
					`${API_BASE}/api/search?caseid=${encodeURIComponent(trimmed)}&per_page=1`
				);
				const data = await res.json();
				const item = Array.isArray(data.items) ? data.items[0] : null;
				if (item) {
					const ageNum = item.age === null || item.age === undefined || item.age === "" ? NaN : Number(item.age);
					demographics = {
						sex: item.sex ?? null,
						age: Number.isFinite(ageNum) ? ageNum : null,
						tumor: typeof item.tumor === "number" ? item.tumor : null,
					};
				}
			} catch {
				/* demographics are optional */
			}
			try {
				const fd = new FormData();
				fd.append("sessionKey", trimmed);
				const res = await fetch(`${API_BASE}/api/mask-data`, { method: "POST", body: fd });
				const data = await res.json();
				if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
				metrics = (data.organ_metrics ?? []) as OrganMetric[];
			} catch {
				error = true;
			}
			if (!cancelled) setState({ loading: false, error, demographics, metrics });
		})();
		return () => {
			cancelled = true;
		};
	}, [id]);
	return state;
}

// Preview thumbnail: local endpoint first, HuggingFace proxy fallback, then a placeholder
// (mirrors the dashboard Preview's chain). In dev/demo both endpoints 404 → placeholder.
function Thumbnail({ id }: { id: string }) {
	const local = `${API_BASE}/api/get_image_preview/${id}`;
	const caseIdStr = `PanTS_${id.toString().padStart(8, "0")}`;
	const hf = `${API_BASE}/api/proxy-image?url=${encodeURIComponent(
		`https://huggingface.co/datasets/BodyMaps/iPanTSMini/resolve/main/profile_only/${caseIdStr}/profile.jpg`
	)}`;
	const [stage, setStage] = useState<0 | 1 | 2>(0);
	useEffect(() => setStage(0), [id]);
	if (stage === 2) return <div className="cmp-thumb cmp-thumb--empty">No preview</div>;
	return (
		<img
			className="cmp-thumb"
			src={stage === 0 ? local : hf}
			alt={`Case ${id} preview`}
			onError={() => setStage((s) => (s === 0 ? 1 : 2))}
		/>
	);
}

const fmtSex = (s: string | null) => (s === "M" ? "Male" : s === "F" ? "Female" : "Unknown");
const fmtAge = (a: number | null) => (a === null ? "Age n/a" : `${Math.round(a)} y`);
const fmtTumor = (t: number | null) => (t === 1 ? "Tumor" : t === 0 ? "No tumor" : "Tumor n/a");

function CaseHeader({ id, data }: { id: string; data: CaseData }) {
	if (!id.trim()) return <div className="cmp-case cmp-case--empty">No case selected</div>;
	return (
		<div className="cmp-case">
			<Thumbnail id={id} />
			<div className="cmp-case__meta">
				<div className="cmp-case__id">Case {id}</div>
				{data.demographics && (
					<div className="cmp-case__demo">
						{fmtSex(data.demographics.sex)} · {fmtAge(data.demographics.age)} ·{" "}
						{fmtTumor(data.demographics.tumor)}
					</div>
				)}
				<Link className="cmp-case__open" to={`/case/${id}`}>
					Open in viewer →
				</Link>
			</div>
		</div>
	);
}

const fmtVol = (v: number | null) => (v === null ? "—" : `${Math.round(v)} cm³`);
const fmtPct = (p: number | null) => (p === null ? "" : `p${Math.round(p)}`);
const fmtDeltaVol = (d: number | null) => (d === null ? "—" : `${d > 0 ? "+" : ""}${Math.round(d)} cm³`);

export default function ComparePage() {
	const [params, setParams] = useSearchParams();
	const idA = params.get("a") ?? "";
	const idB = params.get("b") ?? "";

	const [norms, setNorms] = useState<OrganNorms | null>(null);
	useEffect(() => {
		loadOrganNorms().then((n) => n && setNorms(n));
	}, []);

	const a = useCaseData(idA);
	const b = useCaseData(idB);

	const rowsA = useMemo(
		() => (a.metrics ? computeStatRows(a.metrics, norms, a.demographics?.sex ?? null, a.demographics?.age ?? null) : []),
		[a.metrics, norms, a.demographics]
	);
	const rowsB = useMemo(
		() => (b.metrics ? computeStatRows(b.metrics, norms, b.demographics?.sex ?? null, b.demographics?.age ?? null) : []),
		[b.metrics, norms, b.demographics]
	);
	const compareRows = useMemo(() => alignStatRows(rowsA, rowsB), [rowsA, rowsB]);

	const setId = (key: "a" | "b", value: string) => {
		const next = new URLSearchParams(params);
		if (value.trim()) next.set(key, value.trim());
		else next.delete(key);
		setParams(next, { replace: true });
	};
	const swap = () => {
		const next = new URLSearchParams(params);
		idB ? next.set("a", idB) : next.delete("a");
		idA ? next.set("b", idA) : next.delete("b");
		setParams(next, { replace: true });
	};

	const bothLoaded = compareRows.length > 0;
	const anyError = (idA && a.error) || (idB && b.error);

	return (
		<div className="cmp">
			<div className="cmp__bar">
				<Link className="cmp__home" to="/dashboard" aria-label="Back to dashboard">
					←
				</Link>
				<h1 className="cmp__title">Compare Cases</h1>
				<div className="cmp__inputs">
					<input
						className="cmp__input"
						value={idA}
						onChange={(e) => setId("a", e.target.value)}
						placeholder="Case A id"
						aria-label="Case A id"
					/>
					<button className="cmp__swap" onClick={swap} title="Swap A and B" aria-label="Swap cases">
						⇄
					</button>
					<input
						className="cmp__input"
						value={idB}
						onChange={(e) => setId("b", e.target.value)}
						placeholder="Case B id"
						aria-label="Case B id"
					/>
				</div>
			</div>

			<div className="cmp__cases">
				<CaseHeader id={idA} data={a} />
				<CaseHeader id={idB} data={b} />
			</div>

			{!idA || !idB ? (
				<div className="cmp__msg">Enter two case ids above to compare their organ statistics.</div>
			) : bothLoaded ? (
				<div className="cmp__table">
					<div className="cmp__row cmp__row--head">
						<span>Organ</span>
						<span>Case {idA}</span>
						<span>Case {idB}</span>
						<span>Δ volume</span>
					</div>
					{compareRows.map((r, i) => {
						const dir = r.deltaVolume === null ? "" : r.deltaVolume > 0 ? " cmp-delta--up" : r.deltaVolume < 0 ? " cmp-delta--down" : "";
						return (
							<div className="cmp__row" key={`${r.organ_name}-${i}`}>
								<span className="cmp__organ">{r.label}</span>
								<span className="cmp__cell">
									{fmtVol(r.a?.volume_cm3 ?? null)}
									{r.a?.percentile != null && <em className="cmp__pct">{fmtPct(r.a.percentile)}</em>}
								</span>
								<span className="cmp__cell">
									{fmtVol(r.b?.volume_cm3 ?? null)}
									{r.b?.percentile != null && <em className="cmp__pct">{fmtPct(r.b.percentile)}</em>}
								</span>
								<span className={`cmp__cell cmp__delta${dir}`}>
									{fmtDeltaVol(r.deltaVolume)}
									{r.deltaPercentile != null && (
										<em className="cmp__pct">
											{r.deltaPercentile > 0 ? "+" : ""}
											{Math.round(r.deltaPercentile)} pts
										</em>
									)}
								</span>
							</div>
						);
					})}
				</div>
			) : anyError ? (
				<div className="cmp__msg">
					Organ statistics aren't available for {a.error ? `case ${idA}` : ""}
					{a.error && b.error ? " and " : ""}
					{b.error ? `case ${idB}` : ""} here.
					<br />
					<span style={{ opacity: 0.7 }}>(They're computed from the dataset volumes on the server.)</span>
				</div>
			) : (
				<div className="cmp__msg">Loading…</div>
			)}
		</div>
	);
}
