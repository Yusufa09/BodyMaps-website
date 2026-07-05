import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadUrlAsFile } from "./downloadFile";

describe("downloadUrlAsFile", () => {
	let createObjectURL: ReturnType<typeof vi.fn>;
	let revokeObjectURL: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		createObjectURL = vi.fn(() => "blob:mock-url");
		revokeObjectURL = vi.fn();
		Object.assign(window.URL, { createObjectURL, revokeObjectURL });
	});

	afterEach(() => vi.restoreAllMocks());

	it("rejects on a non-2xx response and never touches the DOM/blob URL", async () => {
		global.fetch = vi.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
		const appendSpy = vi.spyOn(document.body, "appendChild");

		await expect(downloadUrlAsFile("/api/download/1", "case_1.zip")).rejects.toThrow(
			/Download failed \(500\)/
		);
		// Failure must short-circuit before creating the object URL or anchor.
		expect(createObjectURL).not.toHaveBeenCalled();
		expect(appendSpy).not.toHaveBeenCalled();
	});

	it("saves the blob via a temporary anchor on success and revokes the URL", async () => {
		const blob = new Blob(["zipdata"]);
		global.fetch = vi.fn(async () => ({
			ok: true,
			status: 200,
			blob: async () => blob,
		})) as unknown as typeof fetch;

		const clickSpy = vi.fn();
		const realCreate = document.createElement.bind(document);
		vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
			const el = realCreate(tag);
			if (tag === "a") el.click = clickSpy; // jsdom navigation is a no-op; capture the click
			return el;
		});

		await downloadUrlAsFile("/api/download/1", "case_1.zip");

		expect(createObjectURL).toHaveBeenCalledWith(blob);
		expect(clickSpy).toHaveBeenCalledTimes(1);
		// The temporary anchor must be cleaned up.
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
		expect(document.querySelector("a")).toBeNull();
	});

	it("names the downloaded file with the provided filename", async () => {
		global.fetch = vi.fn(async () => ({
			ok: true,
			status: 200,
			blob: async () => new Blob(["x"]),
		})) as unknown as typeof fetch;

		let captured: HTMLAnchorElement | null = null;
		const realCreate = document.createElement.bind(document);
		vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
			const el = realCreate(tag);
			if (tag === "a") {
				el.click = vi.fn();
				captured = el as HTMLAnchorElement;
			}
			return el;
		});

		await downloadUrlAsFile("/api/get_result/abc", "session_abc.zip");

		expect(captured).not.toBeNull();
		expect(captured!.download).toBe("session_abc.zip");
	});
});
