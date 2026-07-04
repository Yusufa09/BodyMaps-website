import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ComparePage from "../routes/ComparePage";

const NORMS = {
	version: 1,
	min_n: 1,
	percentile_grid: [0, 50, 100],
	organs: { liver: { "M|60-69": { n: 100, q: [1000, 1500, 2000] } } },
};

// Different liver volume per case so a real delta shows.
const METRICS: Record<string, unknown> = {
	"1": { organ_metrics: [{ organ_name: "liver", volume_cm3: 1500, mean_hu: 52 }] },
	"2": { organ_metrics: [{ organ_name: "liver", volume_cm3: 1725, mean_hu: 54 }] },
};

beforeEach(() => {
	global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const body = (data: unknown) => ({
			ok: true,
			status: 200,
			json: async () => data,
			text: async () => "",
			blob: async () => new Blob(),
			arrayBuffer: async () => new ArrayBuffer(0),
			headers: { get: () => "application/json" },
		});
		if (url.includes("/organ_norms.json")) return body(NORMS);
		if (url.includes("/api/search")) return body({ items: [{ sex: "M", age: 66, tumor: 0 }] });
		if (url.includes("/api/mask-data")) {
			const key = String((init?.body as FormData)?.get?.("sessionKey") ?? "");
			return body(METRICS[key] ?? { organ_metrics: [] });
		}
		return body({});
	}) as unknown as typeof fetch;
});

afterEach(() => vi.clearAllMocks());

describe("ComparePage", () => {
	it("shows two cases' organ volumes side by side with a delta", async () => {
		render(
			<MemoryRouter initialEntries={["/compare?a=1&b=2"]}>
				<Routes>
					<Route path="/compare" element={<ComparePage />} />
				</Routes>
			</MemoryRouter>
		);

		// Both cases' liver volumes appear…
		expect(await screen.findByText("1500 cm³")).toBeTruthy();
		expect(await screen.findByText("1725 cm³")).toBeTruthy();
		// …and the volume delta (B − A = +225).
		expect(await screen.findByText("+225 cm³")).toBeTruthy();
	});

	it("prompts when only one case id is provided", async () => {
		render(
			<MemoryRouter initialEntries={["/compare?a=1"]}>
				<Routes>
					<Route path="/compare" element={<ComparePage />} />
				</Routes>
			</MemoryRouter>
		);
		expect(await screen.findByText(/Enter two case ids/i)).toBeTruthy();
	});
});
