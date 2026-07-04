import { describe, expect, it } from "vitest";
import type { OrganNorms } from "./organNorms";
import {
	computeStatRows,
	INVALID_METRIC,
	summarizeOutOfRange,
	toCsv,
	toJsonRows,
} from "./organStatsExport";

const NORMS: OrganNorms = {
	version: 1,
	min_n: 1,
	percentile_grid: [0, 50, 100],
	organs: {
		liver: { "M|60-69": { n: 100, q: [1000, 1500, 2000] } },
		spleen: { "M|60-69": { n: 100, q: [100, 200, 300] } },
	},
};

const METRICS = [
	{ organ_name: "liver", volume_cm3: 1500, mean_hu: 52 }, // p50
	{ organ_name: "spleen", volume_cm3: 110, mean_hu: 48 }, // ~p5 boundary → low
	{ organ_name: "stomach", volume_cm3: INVALID_METRIC, mean_hu: INVALID_METRIC }, // invalid
	{ organ_name: "pancreas", volume_cm3: 80, mean_hu: 41 }, // no norm bucket
];

describe("computeStatRows", () => {
	const rows = computeStatRows(METRICS, NORMS, "M", 66);

	it("maps organ names to display labels", () => {
		expect(rows[0].label.toLowerCase()).toContain("liver");
	});

	it("computes a percentile when there's a reference bucket", () => {
		expect(rows[0].percentile).toBe(50);
		expect(rows[0].basis).toBe("M|60-69");
		expect(rows[0].n).toBe(100);
	});

	it("nulls out invalid metrics and absent buckets", () => {
		const stomach = rows.find((r) => r.organ_name === "stomach")!;
		expect(stomach.volume_cm3).toBeNull();
		expect(stomach.mean_hu).toBeNull();
		expect(stomach.percentile).toBeNull();
		const pancreas = rows.find((r) => r.organ_name === "pancreas")!;
		expect(pancreas.volume_cm3).toBe(80); // valid volume…
		expect(pancreas.percentile).toBeNull(); // …but no reference
	});

	it("skips percentiles entirely when norms are absent", () => {
		const noNorm = computeStatRows(METRICS, null, "M", 66);
		expect(noNorm.every((r) => r.percentile === null)).toBe(true);
	});
});

describe("summarizeOutOfRange", () => {
	it("returns only organs below p5 or above p95", () => {
		const rows = computeStatRows(
			[
				{ organ_name: "liver", volume_cm3: 1500, mean_hu: 52 }, // p50 → in range
				{ organ_name: "spleen", volume_cm3: 104, mean_hu: 48 }, // ~p2 → flagged
			],
			NORMS,
			"M",
			66
		);
		const flagged = summarizeOutOfRange(rows);
		expect(flagged).toHaveLength(1);
		expect(flagged[0].label.toLowerCase()).toContain("spleen");
		expect(flagged[0].percentile).toBeLessThan(5);
	});

	it("is empty when everything is mid-range", () => {
		const rows = computeStatRows([{ organ_name: "liver", volume_cm3: 1500, mean_hu: 52 }], NORMS, "M", 66);
		expect(summarizeOutOfRange(rows)).toHaveLength(0);
	});
});

describe("toCsv", () => {
	const rows = computeStatRows(METRICS, NORMS, "M", 66);
	const csv = toCsv(rows);
	const lines = csv.split("\n");

	it("starts with a header row", () => {
		expect(lines[0]).toBe("Organ,Volume (cm3),Mean HU,Percentile,Reference group,n");
	});

	it("renders invalid metrics as NA and missing percentiles as blank", () => {
		const stomachLine = lines.find((l) => l.toLowerCase().includes("stomach"))!;
		// volume + HU are NA; percentile, group, n are empty.
		expect(stomachLine).toContain(",NA,NA,,,");
	});

	it("includes the readable reference group", () => {
		const liverLine = lines.find((l) => l.toLowerCase().includes("liver"))!;
		expect(liverLine).toContain("males 60–69");
		expect(liverLine).toContain("1500");
		expect(liverLine).toContain("50");
	});

	it("quotes cells that contain commas", () => {
		// describeBasis never emits commas, but verify the escaper directly via a label.
		const tricky = toCsv([
			{ organ_name: "x", label: "a, b", volume_cm3: 1, mean_hu: 2, percentile: null, basis: null, n: null },
		]);
		expect(tricky).toContain('"a, b"');
	});
});

describe("toJsonRows", () => {
	it("produces rounded, readable objects", () => {
		const [liver] = toJsonRows(computeStatRows([METRICS[0]], NORMS, "M", 66));
		expect(liver).toMatchObject({
			organ: expect.stringMatching(/liver/i),
			volume_cm3: 1500,
			percentile: 50,
			reference_group: "males 60–69",
			n: 100,
		});
	});
});
