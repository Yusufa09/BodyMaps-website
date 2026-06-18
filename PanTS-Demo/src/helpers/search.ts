// Helpers for the dashboard's advanced search against the backend /api/search.
// Extracted from Homepage so the query-building and id-parsing can be unit-tested.

export type TumorFilter = "any" | "tumor" | "no_tumor";

export type SearchFilters = {
	tumor: TumorFilter;
	sex: string[]; // M / F / UNKNOWN
	age: string[]; // "0-9" … "90-99" / "UNKNOWN"
};

// Minimal shape of an item returned by /api/search and /api/random.
export type SearchItem = {
	case_id?: string | number;
	"PanTS ID"?: string | number;
	id?: string | number;
	tumor?: number | null;
	sex?: string | null;
	age?: number | string | null;
};

// Parse the numeric case id out of any of the id-ish fields, e.g.
// "PanTS_00008854" -> 8854. Returns 0 when nothing usable is present.
export const itemToId = (it: SearchItem): number => {
	const raw = String(it.case_id ?? it["PanTS ID"] ?? it.id ?? "");
	const m = raw.match(/\d+/);
	return m ? Number(m[0]) : 0;
};

// Build the /api/search query string from the active filters. Mirrors the
// backend's expected params: sex[]/age_bin[] (multi), tumor (1/0, omitted for
// "any"), plus optional sort_by / per_page.
export const buildSearchParams = (
	filters: SearchFilters,
	opts: { sortBy?: string; perPage?: number } = {}
): URLSearchParams => {
	const params = new URLSearchParams();
	filters.sex.forEach((v) => params.append("sex[]", v));
	if (filters.tumor === "tumor") params.set("tumor", "1");
	else if (filters.tumor === "no_tumor") params.set("tumor", "0");
	filters.age.forEach((v) => params.append("age_bin[]", v));
	if (opts.sortBy) params.set("sort_by", opts.sortBy);
	if (opts.perPage) params.set("per_page", String(opts.perPage));
	return params;
};
