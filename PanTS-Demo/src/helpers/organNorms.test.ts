import { describe, expect, it } from "vitest";
import {
	ageToBin,
	describeBasis,
	lookupBucket,
	normalizeSex,
	type OrganNorms,
	percentileForOrgan,
	percentileOf,
} from "./organNorms";

describe("ageToBin", () => {
	it("buckets ages into decades", () => {
		expect(ageToBin(0)).toBe("0-9");
		expect(ageToBin(9)).toBe("0-9");
		expect(ageToBin(66)).toBe("60-69");
		expect(ageToBin(60)).toBe("60-69");
		expect(ageToBin(69)).toBe("60-69");
	});

	it("collapses ages >= 90 into 90-99", () => {
		expect(ageToBin(90)).toBe("90-99");
		expect(ageToBin(104)).toBe("90-99");
	});

	it("returns UNKNOWN for missing/invalid ages", () => {
		expect(ageToBin(null)).toBe("UNKNOWN");
		expect(ageToBin(undefined)).toBe("UNKNOWN");
		expect(ageToBin("")).toBe("UNKNOWN");
		expect(ageToBin(-3)).toBe("UNKNOWN");
		expect(ageToBin("not a number")).toBe("UNKNOWN");
	});

	it("accepts numeric strings (as the search API returns)", () => {
		expect(ageToBin("66")).toBe("60-69");
		expect(ageToBin("66.0")).toBe("60-69");
	});
});

describe("normalizeSex", () => {
	it("keeps M/F (any case) and maps everything else to ALL", () => {
		expect(normalizeSex("M")).toBe("M");
		expect(normalizeSex("f")).toBe("F");
		expect(normalizeSex(" m ")).toBe("M");
		expect(normalizeSex("UNKNOWN")).toBe("ALL");
		expect(normalizeSex(null)).toBe("ALL");
		expect(normalizeSex("")).toBe("ALL");
	});
});

describe("percentileOf", () => {
	// grid 0..100 by 25; volumes 100,150,200,260,400 cm³.
	const grid = [0, 25, 50, 75, 100];
	const q = [100, 150, 200, 260, 400];

	it("clamps below/above the range to the grid ends", () => {
		expect(percentileOf(50, grid, q)).toBe(0);
		expect(percentileOf(100, grid, q)).toBe(0);
		expect(percentileOf(400, grid, q)).toBe(100);
		expect(percentileOf(999, grid, q)).toBe(100);
	});

	it("hits exact breakpoints", () => {
		expect(percentileOf(150, grid, q)).toBe(25);
		expect(percentileOf(200, grid, q)).toBe(50);
		expect(percentileOf(260, grid, q)).toBe(75);
	});

	it("interpolates linearly between breakpoints", () => {
		// halfway between q=150 (p25) and q=200 (p50) → p37.5
		expect(percentileOf(175, grid, q)).toBeCloseTo(37.5, 5);
		// quarter way between q=200 (p50) and q=260 (p75): 200+15=215 → p56.25
		expect(percentileOf(215, grid, q)).toBeCloseTo(56.25, 5);
	});

	it("returns the lower edge on tied breakpoints (no divide-by-zero)", () => {
		const flatGrid = [0, 25, 50, 75, 100];
		const flatQ = [10, 20, 20, 20, 30]; // p25..p75 all equal 20
		expect(percentileOf(20, flatGrid, flatQ)).toBe(25);
		expect(Number.isFinite(percentileOf(20, flatGrid, flatQ))).toBe(true);
	});

	it("returns NaN for empty input", () => {
		expect(Number.isNaN(percentileOf(5, [], []))).toBe(true);
	});
});

const NORMS: OrganNorms = {
	version: 1,
	min_n: 20,
	percentile_grid: [0, 50, 100],
	organs: {
		liver: {
			"M|60-69": { n: 50, q: [1000, 1500, 2000] },
			"M|ALL": { n: 400, q: [900, 1450, 2100] },
			"ALL|60-69": { n: 90, q: [950, 1480, 2050] },
			"ALL|ALL": { n: 900, q: [800, 1400, 2200] },
			"F|60-69": { n: 5, q: [1, 2, 3] }, // below min_n → must be skipped
		},
	},
};

describe("lookupBucket", () => {
	it("prefers the specific sex×age bucket when it's large enough", () => {
		const hit = lookupBucket(NORMS, "liver", "M", 66);
		expect(hit?.key).toBe("M|60-69");
	});

	it("falls back past buckets below min_n", () => {
		// F|60-69 has n=5 (< 20); next female-specific bucket is absent, so fall to ALL.
		const hit = lookupBucket(NORMS, "liver", "F", 66);
		expect(hit?.key).toBe("ALL|60-69");
	});

	it("uses an all-sex age bucket for unknown sex", () => {
		expect(lookupBucket(NORMS, "liver", null, 66)?.key).toBe("ALL|60-69");
	});

	it("falls all the way to ALL|ALL for unknown age", () => {
		expect(lookupBucket(NORMS, "liver", "M", null)?.key).toBe("M|ALL");
		expect(lookupBucket(NORMS, "liver", null, null)?.key).toBe("ALL|ALL");
	});

	it("returns null for an organ with no reference", () => {
		expect(lookupBucket(NORMS, "spleen", "M", 66)).toBeNull();
	});
});

describe("percentileForOrgan", () => {
	it("computes a percentile against the chosen bucket", () => {
		// M|60-69 q=[1000,1500,2000]; volume 1500 → p50.
		const r = percentileForOrgan(NORMS, "liver", "M", 66, 1500);
		expect(r?.percentile).toBe(50);
		expect(r?.basis).toBe("M|60-69");
		expect(r?.n).toBe(50);
	});

	it("returns null when volume is invalid or no bucket exists", () => {
		expect(percentileForOrgan(NORMS, "liver", "M", 66, NaN)).toBeNull();
		expect(percentileForOrgan(NORMS, "spleen", "M", 66, 1500)).toBeNull();
	});
});

describe("describeBasis", () => {
	it("renders readable group labels", () => {
		expect(describeBasis("M|60-69")).toBe("males 60–69");
		expect(describeBasis("F|ALL")).toBe("females");
		expect(describeBasis("ALL|60-69")).toBe("ages 60–69");
		expect(describeBasis("ALL|ALL")).toBe("the whole dataset");
	});
});
