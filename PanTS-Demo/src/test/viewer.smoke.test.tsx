import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The CT viewer relies on WebGL (Niivue + Cornerstone) and a three.js loader,
// none of which run under jsdom/CI (no GPU). Mock those modules so we can verify
// the page component itself mounts and wires up without crashing.
vi.mock("@niivue/niivue", () => ({
	Niivue: class {
		attachToCanvas() {}
		loadVolumes() {
			return Promise.resolve();
		}
		setSliceType() {}
		setInterpolation() {}
		drawScene() {}
	},
}));

vi.mock("../helpers/CornerstoneNifti2", () => ({
	getOrganLabelOnClick: vi.fn(),
	moveCornerstoneCrosshairToMm: vi.fn(),
	renderVisualization: vi.fn().mockResolvedValue(undefined),
	setToolGroupOpacity: vi.fn(),
	setVisibilities: vi.fn(),
	subscribeToCrosshairChanges: vi.fn(),
	subscribeToVolumeProgress: vi.fn(() => () => {}),
	toggleCrosshairTool: vi.fn(),
	setActiveMeasurementTool: vi.fn(),
	clearMeasurements: vi.fn(),
	getCrosshairMm: vi.fn(() => null),
	getOrganCentroids: vi.fn(() => null),
	// Measurement inventory + reading-session capture APIs
	getMeasurementSummaries: vi.fn(() => []),
	subscribeToMeasurementChanges: vi.fn(() => () => {}),
	captureViewportImages: vi.fn(async () => []),
	renameMeasurement: vi.fn(),
	removeMeasurement: vi.fn(),
	jumpToMeasurement: vi.fn(() => null),
	// Zoom controls now live in the top toolbar (previously ZoomHandle)
	setZoom: vi.fn(),
	centerOnCursor: vi.fn(),
	zoomToFit: vi.fn(),
	LENGTH_TOOL: "Length",
	PROBE_TOOL: "Probe",
	ROI_TOOL: "RectangleROI",
	ANGLE_TOOL: "Angle",
	ELLIPSE_TOOL: "EllipticalROI",
}));

vi.mock("../helpers/NiiVueNifti", () => ({
	create3DVolume: vi.fn().mockResolvedValue(undefined),
	moveNiiVueCrosshairToMm: vi.fn(),
	updateVisibilities: vi.fn(),
}));

vi.mock("../components/Loading", async () => {
	const React = await import("react");
	return { default: () => React.createElement("div", { "data-testid": "viewer-loader" }) };
});

import VisualizationPage from "../routes/VisualizationPage";

beforeEach(() => {
	global.fetch = vi.fn(async () => ({
		ok: true,
		status: 200,
		arrayBuffer: async () => new ArrayBuffer(0),
		blob: async () => new Blob(),
		json: async () => ({}),
		text: async () => "",
		headers: { get: () => "application/json" },
	})) as unknown as typeof fetch;
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("viewer smoke test", () => {
	it("VisualizationPage mounts for a dataset case without crashing", () => {
		const { container } = render(
			<MemoryRouter initialEntries={["/case/1"]}>
				<Routes>
					<Route path="/case/:caseId" element={<VisualizationPage />} />
				</Routes>
			</MemoryRouter>
		);
		expect(container.firstChild).toBeTruthy();
	});
});
