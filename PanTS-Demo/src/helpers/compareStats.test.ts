import { describe, expect, it } from "vitest";
import { alignStatRows } from "./compareStats";
import type { StatRow } from "./organStatsExport";

const row = (organ: string, vol: number | null, pct: number | null): StatRow => ({
	organ_name: organ,
	label: organ[0].toUpperCase() + organ.slice(1),
	volume_cm3: vol,
	mean_hu: 40,
	percentile: pct,
	basis: pct === null ? null : "M|60-69",
	n: pct === null ? null : 100,
});

describe("alignStatRows", () => {
	it("unions organs in first-seen order (A first, then B-only)", () => {
		const a = [row("liver", 1500, 50), row("spleen", 200, 40)];
		const b = [row("liver", 1700, 70), row("kidney_left", 160, 55)];
		const merged = alignStatRows(a, b);
		expect(merged.map((r) => r.organ_name)).toEqual(["liver", "spleen", "kidney_left"]);
	});

	it("computes volume and percentile deltas as B − A", () => {
		const merged = alignStatRows([row("liver", 1500, 50)], [row("liver", 1725, 78)]);
		expect(merged[0].deltaVolume).toBe(225);
		expect(merged[0].deltaPercentile).toBe(28);
	});

	it("leaves deltas null when an organ is missing from one case", () => {
		const merged = alignStatRows([row("liver", 1500, 50)], [row("spleen", 200, 40)]);
		const liver = merged.find((r) => r.organ_name === "liver")!;
		expect(liver.a).not.toBeNull();
		expect(liver.b).toBeNull();
		expect(liver.deltaVolume).toBeNull();
		expect(liver.deltaPercentile).toBeNull();
	});

	it("leaves deltas null when a volume or percentile is invalid on one side", () => {
		const merged = alignStatRows([row("liver", null, null)], [row("liver", 1700, 70)]);
		expect(merged[0].deltaVolume).toBeNull();
		expect(merged[0].deltaPercentile).toBeNull();
		expect(merged[0].a).not.toBeNull(); // row still present, just no delta
	});

	it("keeps a readable label even for a B-only organ", () => {
		const merged = alignStatRows([], [row("pancreas", 80, 50)]);
		expect(merged[0].label).toBe("Pancreas");
		expect(merged[0].a).toBeNull();
	});
});
