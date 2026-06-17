import { describe, expect, it } from "vitest";
import { buildSearchParams, itemToId, type SearchFilters } from "./search";

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
	const base: SearchFilters = { tumor: "any", sex: [], age: [] };

	it("omits the tumor param for 'any' and maps tumor/no_tumor to 1/0", () => {
		expect(buildSearchParams(base).has("tumor")).toBe(false);
		expect(buildSearchParams({ ...base, tumor: "tumor" }).get("tumor")).toBe("1");
		expect(buildSearchParams({ ...base, tumor: "no_tumor" }).get("tumor")).toBe("0");
	});

	it("appends sex[] and age_bin[] for each selected value", () => {
		const params = buildSearchParams({
			tumor: "any",
			sex: ["M", "F"],
			age: ["0-9", "90-99"],
		});
		expect(params.getAll("sex[]")).toEqual(["M", "F"]);
		expect(params.getAll("age_bin[]")).toEqual(["0-9", "90-99"]);
	});

	it("adds sort_by and per_page only when provided", () => {
		expect(buildSearchParams(base).has("sort_by")).toBe(false);
		const params = buildSearchParams(base, { sortBy: "quality", perPage: 12 });
		expect(params.get("sort_by")).toBe("quality");
		expect(params.get("per_page")).toBe("12");
	});
});
