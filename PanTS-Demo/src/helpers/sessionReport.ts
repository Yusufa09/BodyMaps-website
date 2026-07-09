// Reading-session report generation — pure functions only (no DOM, no Cornerstone),
// so this module is unit-testable and reusable. A "reading session" is the recorded
// trace of a radiologist reviewing a case: timestamped viewer events, dictated
// transcript segments, screenshots, and the measurements left on the images. The
// draft report is assembled from that trace by templates — deliberately NOT by an
// AI model — so its content is exactly what happened in the viewer.

export type SessionEvent = {
	/** ms since session start */
	t: number;
	/** short machine tag: navigate | window | preset | view | measure | screenshot | organ | opacity | session */
	type: string;
	/** human-readable line for the timeline */
	detail: string;
};

export type SessionShotImage = { name: string; dataUrl: string };

export type SessionShot = {
	t: number;
	label: string;
	images: SessionShotImage[];
};

export type TranscriptSegment = { t: number; text: string };

export type ReportMeasurement = { tool: string; label: string; value: string };

export type ReportInput = {
	caseId: string;
	startedAt: number; // epoch ms
	durationMs: number;
	events: SessionEvent[];
	shots: SessionShot[];
	transcript: TranscriptSegment[];
	measurements: ReportMeasurement[];
};

/** 83000 → "01:23" (grows to H:MM:SS past an hour). */
export function formatClock(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const s = total % 60;
	const m = Math.floor(total / 60) % 60;
	const h = Math.floor(total / 3600);
	const mm = String(m).padStart(2, "0");
	const ss = String(s).padStart(2, "0");
	return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export type CondensedEvent = SessionEvent & { count: number };

// Scrubbing slices or dragging a slider emits bursts of same-type events; the
// timeline reads better as one line per burst ("navigated ×12") than as spam.
export function condenseEvents(events: SessionEvent[]): CondensedEvent[] {
	const out: CondensedEvent[] = [];
	for (const e of events) {
		const last = out[out.length - 1];
		if (last && last.type === e.type) {
			last.count += 1;
			last.detail = e.detail; // keep the final state of the burst
		} else {
			out.push({ ...e, count: 1 });
		}
	}
	return out;
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
	Length: "Distance",
	Angle: "Angle",
	Probe: "HU probe",
	RectangleROI: "Rectangle ROI",
	EllipticalROI: "Ellipse ROI",
};

export function toolDisplayName(tool: string): string {
	return TOOL_DISPLAY_NAMES[tool] ?? tool;
}

function fmtDate(epochMs: number): string {
	try {
		return new Date(epochMs).toLocaleString();
	} catch {
		return String(epochMs);
	}
}

// Derive a one-line "technique" summary from the trace: which window presets and
// view layouts the reader actually used.
export function summarizeTechnique(events: SessionEvent[]): string[] {
	const presets = new Set<string>();
	const views = new Set<string>();
	for (const e of events) {
		if (e.type === "preset") presets.add(e.detail.replace(/^Applied\s+/, "").replace(/\s+window$/, ""));
		if (e.type === "view") views.add(e.detail.replace(/^Switched to\s+/, "").replace(/\s+view$/, ""));
	}
	const lines: string[] = [];
	if (views.size) lines.push(`Views reviewed: ${[...views].join(", ")}`);
	if (presets.size) lines.push(`Window presets: ${[...presets].join(", ")}`);
	return lines;
}

export function buildReportMarkdown(input: ReportInput): string {
	const { caseId, startedAt, durationMs, events, shots, transcript, measurements } = input;
	const lines: string[] = [];
	lines.push(`# Draft reading report — case ${caseId}`);
	lines.push("");
	lines.push(`- **Read on:** ${fmtDate(startedAt)}`);
	lines.push(`- **Reading time:** ${formatClock(durationMs)}`);
	lines.push(`- **Events captured:** ${events.length} · **Key images:** ${shots.length}`);
	const technique = summarizeTechnique(events);
	if (technique.length) {
		lines.push("");
		lines.push("## Technique");
		for (const t of technique) lines.push(`- ${t}`);
	}
	lines.push("");
	lines.push("## Dictated findings");
	if (transcript.length) {
		for (const seg of transcript) lines.push(`- \`[${formatClock(seg.t)}]\` ${seg.text}`);
	} else {
		lines.push("_No dictation captured (see the session audio for the spoken narration)._");
	}
	lines.push("");
	lines.push("## Measurements");
	if (measurements.length) {
		lines.push("| # | Tool | Label | Value |");
		lines.push("|---|------|-------|-------|");
		measurements.forEach((m, i) => {
			lines.push(`| ${i + 1} | ${toolDisplayName(m.tool)} | ${m.label || "—"} | ${m.value} |`);
		});
	} else {
		lines.push("_No measurements taken._");
	}
	lines.push("");
	lines.push("## Key images");
	if (shots.length) {
		shots.forEach((s, i) => {
			lines.push(`${i + 1}. \`[${formatClock(s.t)}]\` ${s.label} (${s.images.map((im) => im.name).join(", ")})`);
		});
	} else {
		lines.push("_No screenshots captured._");
	}
	lines.push("");
	lines.push("## Reading timeline");
	for (const e of condenseEvents(events)) {
		lines.push(`- \`[${formatClock(e.t)}]\` ${e.detail}${e.count > 1 ? ` _(×${e.count})_` : ""}`);
	}
	lines.push("");
	lines.push("---");
	lines.push(
		"_Draft assembled from a recorded reading session in the BodyMaps viewer. " +
			"Review and edit before any clinical use — this is not medical advice or a diagnostic report._"
	);
	return lines.join("\n");
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

// Self-contained (screenshots embedded as data URLs), print-friendly HTML version.
export function buildReportHtml(input: ReportInput): string {
	const { caseId, startedAt, durationMs, events, shots, transcript, measurements } = input;
	const technique = summarizeTechnique(events);
	const section = (title: string, body: string) =>
		`<section><h2>${escapeHtml(title)}</h2>${body}</section>`;

	const dictation = transcript.length
		? `<ul class="dictation">${transcript
				.map((s) => `<li><span class="t">[${formatClock(s.t)}]</span> ${escapeHtml(s.text)}</li>`)
				.join("")}</ul>`
		: `<p class="muted">No dictation captured (see the session audio for the spoken narration).</p>`;

	const measureRows = measurements
		.map(
			(m, i) =>
				`<tr><td>${i + 1}</td><td>${escapeHtml(toolDisplayName(m.tool))}</td><td>${
					m.label ? escapeHtml(m.label) : "—"
				}</td><td>${escapeHtml(m.value)}</td></tr>`
		)
		.join("");
	const measureTable = measurements.length
		? `<table><thead><tr><th>#</th><th>Tool</th><th>Label</th><th>Value</th></tr></thead><tbody>${measureRows}</tbody></table>`
		: `<p class="muted">No measurements taken.</p>`;

	const shotBlocks = shots.length
		? shots
				.map(
					(s) =>
						`<figure><figcaption><span class="t">[${formatClock(s.t)}]</span> ${escapeHtml(
							s.label
						)}</figcaption><div class="imgs">${s.images
							.map(
								(im) =>
									`<div class="img"><img src="${im.dataUrl}" alt="${escapeHtml(im.name)}"/><span>${escapeHtml(
										im.name
									)}</span></div>`
							)
							.join("")}</div></figure>`
				)
				.join("")
		: `<p class="muted">No screenshots captured.</p>`;

	const timeline = condenseEvents(events)
		.map(
			(e) =>
				`<li><span class="t">[${formatClock(e.t)}]</span> ${escapeHtml(e.detail)}${
					e.count > 1 ? ` <span class="muted">(×${e.count})</span>` : ""
				}</li>`
		)
		.join("");

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Draft reading report — case ${escapeHtml(caseId)}</title>
<style>
	body { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #16181d; max-width: 880px; margin: 0 auto; padding: 32px 24px 56px; line-height: 1.5; }
	h1 { font-size: 24px; margin-bottom: 4px; }
	h2 { font-size: 16px; text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 2px solid #16181d; padding-bottom: 4px; margin-top: 32px; }
	.meta { color: #555; font-size: 13px; }
	.t { font-family: ui-monospace, monospace; font-size: 12px; color: #888; margin-right: 6px; }
	.muted { color: #888; }
	table { border-collapse: collapse; width: 100%; font-size: 14px; }
	th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
	th { background: #f4f5f7; }
	figure { margin: 18px 0; page-break-inside: avoid; }
	figcaption { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
	.imgs { display: flex; gap: 8px; flex-wrap: wrap; }
	.img { flex: 1 1 220px; max-width: 32%; min-width: 180px; }
	.img img { width: 100%; border: 1px solid #ddd; border-radius: 4px; background: #000; }
	.img span { display: block; font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 2px; }
	ul { padding-left: 18px; }
	.timeline li { font-size: 13px; }
	.disclaimer { margin-top: 40px; padding: 12px 14px; background: #fff7ed; border: 1px solid #fdba74; border-radius: 8px; font-size: 13px; color: #7c2d12; }
	@media print { body { padding: 0; } .disclaimer { break-inside: avoid; } }
</style>
</head>
<body>
<h1>Draft reading report — case ${escapeHtml(caseId)}</h1>
<p class="meta">Read on ${escapeHtml(fmtDate(startedAt))} · reading time ${formatClock(durationMs)} · ${
		events.length
	} events · ${shots.length} key image${shots.length === 1 ? "" : "s"}</p>
${technique.length ? section("Technique", `<ul>${technique.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`) : ""}
${section("Dictated findings", dictation)}
${section("Measurements", measureTable)}
${section("Key images", shotBlocks)}
${section("Reading timeline", `<ul class="timeline">${timeline}</ul>`)}
<div class="disclaimer">Draft assembled from a recorded reading session in the BodyMaps viewer. Review and edit before any clinical use — this is not medical advice or a diagnostic report.</div>
</body>
</html>`;
}
