import { beforeEach, describe, expect, it } from "vitest";
import {
	addRecentUpload,
	formatRelativeTime,
	loadRecentUploads,
	MAX_RECENT_UPLOADS,
	recentStatusColor,
	updateRecentUploadStatus,
	type RecentUpload,
} from "./recentUploads";

const makeEntry = (overrides: Partial<RecentUpload> = {}): RecentUpload => ({
	sessionId: "s1",
	label: "ct.nii.gz",
	model: "SuPreM",
	status: "Processing",
	timestamp: Date.now(),
	...overrides,
});

beforeEach(() => {
	localStorage.clear();
});

describe("loadRecentUploads", () => {
	it("returns an empty array when nothing is stored", () => {
		expect(loadRecentUploads()).toEqual([]);
	});

	it("returns an empty array when storage holds malformed JSON", () => {
		localStorage.setItem("recentUploads", "{not json");
		expect(loadRecentUploads()).toEqual([]);
	});
});

describe("addRecentUpload", () => {
	it("prepends the newest entry", () => {
		addRecentUpload(makeEntry({ sessionId: "a" }));
		const list = addRecentUpload(makeEntry({ sessionId: "b" }));
		expect(list.map((u) => u.sessionId)).toEqual(["b", "a"]);
	});

	it("de-duplicates by sessionId (re-adding moves it to the front)", () => {
		addRecentUpload(makeEntry({ sessionId: "a" }));
		addRecentUpload(makeEntry({ sessionId: "b" }));
		const list = addRecentUpload(makeEntry({ sessionId: "a", label: "updated" }));
		expect(list.map((u) => u.sessionId)).toEqual(["a", "b"]);
		expect(list.filter((u) => u.sessionId === "a")).toHaveLength(1);
		expect(list[0].label).toBe("updated");
	});

	it(`caps the list at ${MAX_RECENT_UPLOADS} entries`, () => {
		for (let i = 0; i < MAX_RECENT_UPLOADS + 4; i++) {
			addRecentUpload(makeEntry({ sessionId: `s${i}` }));
		}
		expect(loadRecentUploads()).toHaveLength(MAX_RECENT_UPLOADS);
	});
});

describe("updateRecentUploadStatus", () => {
	it("updates only the matching session's status", () => {
		addRecentUpload(makeEntry({ sessionId: "a" }));
		addRecentUpload(makeEntry({ sessionId: "b" }));
		const list = updateRecentUploadStatus("a", "Completed");
		expect(list.find((u) => u.sessionId === "a")?.status).toBe("Completed");
		expect(list.find((u) => u.sessionId === "b")?.status).toBe("Processing");
	});
});

describe("formatRelativeTime", () => {
	it("formats recent, minutes, hours, and days", () => {
		const now = Date.now();
		expect(formatRelativeTime(now)).toBe("Just now");
		expect(formatRelativeTime(now - 5 * 60_000)).toBe("5 mins ago");
		expect(formatRelativeTime(now - 1 * 60_000)).toBe("1 min ago");
		expect(formatRelativeTime(now - 3 * 60 * 60_000)).toBe("3 hours ago");
		expect(formatRelativeTime(now - 25 * 60 * 60_000)).toBe("Yesterday");
		expect(formatRelativeTime(now - 4 * 24 * 60 * 60_000)).toBe("4 days ago");
	});
});

describe("recentStatusColor", () => {
	it("maps each status to its color", () => {
		expect(recentStatusColor("Failed")).toBe("#ef4444");
		expect(recentStatusColor("Processing")).toBe("#6a6a6a");
		expect(recentStatusColor("Completed")).toBe("#8f8f8f");
	});
});
