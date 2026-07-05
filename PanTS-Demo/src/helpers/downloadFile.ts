// Fetches a URL and saves the response as a file via a temporary anchor.
// Throws on a non-2xx response so callers can surface an error to the user
// instead of silently downloading an error page / hitting an unhandled
// rejection. Extracted from VisualizationPage so the behaviour is unit-testable.
export async function downloadUrlAsFile(url: string, filename: string): Promise<void> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Download failed (${response.status})`);
	}
	const blob = await response.blob();
	const objectUrl = window.URL.createObjectURL(blob);

	const link = document.createElement("a");
	link.href = objectUrl;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	window.URL.revokeObjectURL(objectUrl);
}
