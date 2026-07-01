// Derive the Organ Statistics rows once (volume + mean HU + population percentile) and
// turn them into a CSV/JSON download or an out-of-range summary. Keeping this in one
// place means the table, the summary banner, and the export all agree. The row math is
// pure + unit-tested (organStatsExport.test.ts); only downloadStats touches the DOM.
import { describeBasis, type OrganNorms, percentileForOrgan } from "./organNorms";
import { filenameToName } from "./utils";

// Sentinel the backend uses for an organ whose metric is unreliable (mask clipped at the
// volume edge). Mirrors NiftiProcessor.number_max.
export const INVALID_METRIC = 999999;

export type OrganMetric = { organ_name: string; volume_cm3: number; mean_hu: number };

export type StatRow = {
	organ_name: string;
	label: string; // display name (e.g. "Kidney (left)")
	volume_cm3: number | null; // null when the backend flagged it invalid
	mean_hu: number | null;
	percentile: number | null; // 0–100, or null when there's no reference
	basis: string | null; // bucket key the percentile came from, e.g. "M|60-69"
	n: number | null; // sample size behind that bucket
};

// Build the display/export rows from the raw metrics + (optional) population norms.
export function computeStatRows(
	stats: OrganMetric[],
	norms: OrganNorms | null,
	sex: string | null,
	age: number | null,
): StatRow[] {
	return stats.map((o) => {
		const badVol = o.volume_cm3 === INVALID_METRIC;
		const badHu = o.mean_hu === INVALID_METRIC;
		const p = !badVol && norms ? percentileForOrgan(norms, o.organ_name, sex, age, o.volume_cm3) : null;
		return {
			organ_name: o.organ_name,
			label: filenameToName(o.organ_name),
			volume_cm3: badVol ? null : o.volume_cm3,
			mean_hu: badHu ? null : o.mean_hu,
			percentile: p ? p.percentile : null,
			basis: p ? p.basis : null,
			n: p ? p.n : null,
		};
	});
}

// Organs sitting in the distribution tails (< p5 or > p95) — the panel's summary line.
export function summarizeOutOfRange(rows: StatRow[]): { label: string; percentile: number }[] {
	return rows
		.filter((r) => r.percentile !== null && (r.percentile < 5 || r.percentile > 95))
		.map((r) => ({ label: r.label, percentile: r.percentile as number }));
}

const csvCell = (v: string | number): string => {
	const s = String(v);
	// Quote if the value contains a comma, quote, or newline (RFC 4180).
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// CSV with a header row. Invalid/missing metrics render as "NA"; absent percentiles blank.
export function toCsv(rows: StatRow[]): string {
	const header = ["Organ", "Volume (cm3)", "Mean HU", "Percentile", "Reference group", "n"];
	const lines = rows.map((r) =>
		[
			csvCell(r.label),
			r.volume_cm3 === null ? "NA" : Math.round(r.volume_cm3),
			r.mean_hu === null ? "NA" : Math.round(r.mean_hu),
			r.percentile === null ? "" : Math.round(r.percentile),
			r.basis === null ? "" : csvCell(describeBasis(r.basis)),
			r.n === null ? "" : r.n,
		].join(",")
	);
	return [header.join(","), ...lines].join("\n");
}

// Plain JSON objects for the .json export — rounded, with a readable group label.
export function toJsonRows(rows: StatRow[]): Record<string, unknown>[] {
	return rows.map((r) => ({
		organ: r.label,
		volume_cm3: r.volume_cm3 === null ? null : Math.round(r.volume_cm3),
		mean_hu: r.mean_hu === null ? null : Math.round(r.mean_hu),
		percentile: r.percentile === null ? null : Math.round(r.percentile),
		reference_group: r.basis === null ? null : describeBasis(r.basis),
		n: r.n,
	}));
}

// Trigger a browser download of the rows as CSV or JSON. DOM side-effect — not unit-tested.
export function downloadStats(rows: StatRow[], format: "csv" | "json", caseId: string): void {
	const content = format === "csv" ? toCsv(rows) : JSON.stringify(toJsonRows(rows), null, 2);
	const mime = format === "csv" ? "text/csv" : "application/json";
	const blob = new Blob([content], { type: `${mime};charset=utf-8` });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `case_${caseId}_organ_stats.${format}`;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}
