// Saved/bookmarked dataset cases, persisted in localStorage (mirrors the recentUploads
// pattern). The card's metadata is stored at bookmark time so the "Saved" view can render
// directly from localStorage — no extra backend/metadata fetch. Pure + unit-tested;
// components subscribe to SAVED_CASES_EVENT (in-tab) and the native "storage" event
// (cross-tab) to stay in sync.

export type SavedCase = {
	id: number;
	sex: string;
	age: number;
	tumor: number;
	savedAt: number;
};

export const SAVED_CASES_KEY = "savedCases";
export const SAVED_CASES_EVENT = "savedcaseschange";

export const loadSavedCases = (): SavedCase[] => {
	try {
		const arr = JSON.parse(localStorage.getItem(SAVED_CASES_KEY) || "[]");
		return Array.isArray(arr) ? arr.filter((c) => c && typeof c.id === "number") : [];
	} catch {
		return [];
	}
};

const persistSavedCases = (list: SavedCase[]) => {
	try {
		localStorage.setItem(SAVED_CASES_KEY, JSON.stringify(list));
	} catch (e) {
		console.warn("persistSavedCases failed", e);
	}
	// The native "storage" event only fires in *other* tabs, so notify this tab explicitly.
	try {
		window.dispatchEvent(new Event(SAVED_CASES_EVENT));
	} catch {
		/* no window (SSR/tests without a DOM) — ignore */
	}
};

export const isSavedCase = (id: number): boolean => loadSavedCases().some((c) => c.id === id);

// Add the case if it isn't saved, otherwise remove it. Returns the updated list (most
// recently saved first).
export const toggleSavedCase = (entry: Omit<SavedCase, "savedAt">): SavedCase[] => {
	const list = loadSavedCases();
	const next = list.some((c) => c.id === entry.id)
		? list.filter((c) => c.id !== entry.id)
		: [{ ...entry, savedAt: Date.now() }, ...list];
	persistSavedCases(next);
	return next;
};
