import { describe, expect, it } from "vitest";
import {
	buildSearchParams,
	countActiveFilters,
	EMPTY_FILTERS,
	itemToId,
	parseFiltersFromParams,
	type SearchFilters,
} from "./search";

describe("itemToId", () => {
	it("parses the numeric id out of a PanTS case id", () => {
		expect(itemToId({ case_id: "PanTS_00008854" })).toBe(8854);
		expect(itemToId({ case_id: "PanTS_00000001" })).toBe(1);
	});

	it("falls back across id fields and handles numbers", () => {
		expect(itemToId({ "PanTS ID": "PanTS_00000900" })).toBe(900);
		expect(itemToId({ id: 42 })).toBe(42);
	});

	it("returns 0 when no usable id is present", () => {
		expect(itemToId({})).toBe(0);
		expect(itemToId({ case_id: "no-digits-here" })).toBe(0);
	});
});

describe("buildSearchParams", () => {
	const base: SearchFilters = EMPTY_FILTERS;

	it("omits the tumor param for 'any' and maps tumor/no_tumor to 1/0", () => {
		expect(buildSearchParams(base).has("tumor")).toBe(false);
		expect(buildSearchParams({ ...base, tumor: "tumor" }).get("tumor")).toBe("1");
		expect(buildSearchParams({ ...base, tumor: "no_tumor" }).get("tumor")).toBe("0");
	});

	it("appends sex[] and age_bin[] for each selected value", () => {
		const params = buildSearchParams({
			...base,
			sex: ["M", "F"],
			age: ["0-9", "90-99"],
		});
		expect(params.getAll("sex[]")).toEqual(["M", "F"]);
		expect(params.getAll("age_bin[]")).toEqual(["0-9", "90-99"]);
	});

	it("appends the metadata facet filters with their backend param names", () => {
		const params = buildSearchParams({
			...base,
			manufacturer: ["SIEMENS"],
			ctPhase: ["Arterial"],
			siteNat: ["US"],
			year: ["2018", "2019"],
		});
		expect(params.getAll("manufacturer[]")).toEqual(["SIEMENS"]);
		expect(params.getAll("ct_phase[]")).toEqual(["Arterial"]);
		expect(params.getAll("site_nat[]")).toEqual(["US"]);
		expect(params.getAll("year[]")).toEqual(["2018", "2019"]);
	});

	it("adds sort_by and per_page only when provided", () => {
		expect(buildSearchParams(base).has("sort_by")).toBe(false);
		const params = buildSearchParams(base, { sortBy: "quality", perPage: 12 });
		expect(params.get("sort_by")).toBe("quality");
		expect(params.get("per_page")).toBe("12");
	});
});

describe("parseFiltersFromParams", () => {
	it("round-trips filters through the URL query string", () => {
		const filters: SearchFilters = {
			tumor: "tumor",
			sex: ["F"],
			age: ["50-59"],
			manufacturer: ["GE"],
			ctPhase: ["Venous"],
			siteNat: ["US"],
			year: ["2020"],
		};
		const restored = parseFiltersFromParams(buildSearchParams(filters));
		expect(restored).toEqual(filters);
	});

	it("defaults to EMPTY_FILTERS for an empty query", () => {
		expect(parseFiltersFromParams(new URLSearchParams())).toEqual(EMPTY_FILTERS);
	});
});

describe("countActiveFilters", () => {
	it("counts tumor + every selected multi value", () => {
		expect(countActiveFilters(EMPTY_FILTERS)).toBe(0);
		expect(
			countActiveFilters({ ...EMPTY_FILTERS, tumor: "tumor", sex: ["M"], year: ["2018", "2019"] })
		).toBe(4);
	});
});
