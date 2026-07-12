import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LandingPage from "../pages/LandingPage";
import Homepage from "../routes/Homepage";
import UploadPage from "../routes/UploadPage";

// Smoke tests: each routed page should mount and render its key content without
// crashing. API calls are stubbed so the dashboard's data fetch resolves to an
// empty result set instead of hitting a real backend.
beforeEach(() => {
	global.fetch = vi.fn(async () => ({
		ok: true,
		status: 200,
		json: async () => ({ items: [], total: 0, ids: [] }),
		text: async () => "",
		headers: { get: () => "application/json" },
	})) as unknown as typeof fetch;
	localStorage.clear();
});

afterEach(() => {
	vi.restoreAllMocks();
});

const renderRoute = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("route smoke tests", () => {
	it("LandingPage (Overview) renders", () => {
		renderRoute(<LandingPage />);
		expect(
			screen.getByText("The open library of labeled body CT scans")
		).toBeInTheDocument();
	});

	it("Homepage (Dashboard) renders", async () => {
		renderRoute(<Homepage />);
		expect(await screen.findByText("Browse Library")).toBeInTheDocument();
	});

	it("UploadPage renders", async () => {
		renderRoute(<UploadPage />);
		expect(
			await screen.findByText("Drag a file or folder here, or")
		).toBeInTheDocument();
	});
});
