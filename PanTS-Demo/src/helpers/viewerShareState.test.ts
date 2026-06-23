import { describe, expect, it } from "vitest";
import { decodeViewerState, encodeViewerState, type ViewerShareState } from "./viewerShareState";

const roundTrip = (s: ViewerShareState) => decodeViewerState(new URLSearchParams(encodeViewerState(s).toString()));

describe("encodeViewerState", () => {
	it("omits defaults so a plain link stays clean", () => {
		expect(encodeViewerState({ view: "mpr" }).toString()).toBe("");
		expect(encodeViewerState({}).toString()).toBe("");
		expect(encodeViewerState({ hidden: [] }).toString()).toBe("");
	});

	it("writes only the non-default fields", () => {
		const p = encodeViewerState({ view: "axial", ww: 400, wc: 40, opacity: 75 });
		expect(p.get("view")).toBe("axial");
		expect(p.get("ww")).toBe("400");
		expect(p.get("wc")).toBe("40");
		expect(p.get("op")).toBe("75");
	});

	it("rounds window/center to integers and crosshair to 1 dp", () => {
		const p = encodeViewerState({ ww: 399.6, wc: 39.9, crosshair: [12.345, -6.789, 0.04] });
		expect(p.get("ww")).toBe("400");
		expect(p.get("wc")).toBe("40");
		expect(p.get("c")).toBe("12.3,-6.8,0");
	});

	it("dedupes and sorts hidden organ ids and drops non-positive ones", () => {
		expect(encodeViewerState({ hidden: [3, 1, 3, 0, -2, 7] }).get("hide")).toBe("1,3,7");
	});

	it("clamps opacity into 0–100", () => {
		expect(encodeViewerState({ opacity: 150 }).get("op")).toBe("100");
		expect(encodeViewerState({ opacity: -5 }).get("op")).toBe("0");
	});
});

describe("decodeViewerState", () => {
	it("ignores an invalid view and keeps valid ones", () => {
		expect(decodeViewerState(new URLSearchParams("view=banana")).view).toBeUndefined();
		expect(decodeViewerState(new URLSearchParams("view=3d")).view).toBe("3d");
	});

	it("drops non-numeric / non-positive window width", () => {
		expect(decodeViewerState(new URLSearchParams("ww=abc")).ww).toBeUndefined();
		expect(decodeViewerState(new URLSearchParams("ww=0")).ww).toBeUndefined();
		expect(decodeViewerState(new URLSearchParams("ww=1500")).ww).toBe(1500);
	});

	it("parses hidden ids and ignores garbage entries", () => {
		expect(decodeViewerState(new URLSearchParams("hide=2,x,5,-1,2")).hidden).toEqual([2, 5]);
	});

	it("only accepts a 3-number crosshair", () => {
		expect(decodeViewerState(new URLSearchParams("c=1,2")).crosshair).toBeUndefined();
		expect(decodeViewerState(new URLSearchParams("c=1,2,3")).crosshair).toEqual([1, 2, 3]);
	});

	it("reads the hd flag", () => {
		expect(decodeViewerState(new URLSearchParams("hd=1")).hd).toBe(true);
		expect(decodeViewerState(new URLSearchParams("")).hd).toBeUndefined();
	});
});

describe("round trip", () => {
	it("preserves a full state through encode → decode", () => {
		const s: ViewerShareState = {
			view: "coronal",
			ww: 1500,
			wc: -600,
			opacity: 60,
			hidden: [4, 9],
			crosshair: [10.2, -3.5, 88.1],
			hd: true,
		};
		expect(roundTrip(s)).toEqual(s);
	});
});
