// Voice-assisted reading session recorder. While a radiologist reviews a case the
// session captures, entirely client-side:
//   - microphone narration (MediaRecorder → webm/mp4 audio), if the mic is granted
//   - a live dictation transcript via the browser's Web Speech API, if available
//   - a timestamped event timeline (the viewer logs navigation, window/level,
//     presets, measurements, screenshots into it)
//   - screenshots ("key images") captured by the viewer at the right moments
// Everything fails soft: no mic / no speech API just means an events-only session.
// Nothing is uploaded anywhere — the result stays in the browser until the user
// downloads the bundle or the draft report.

import type {
	ReportMeasurement,
	SessionEvent,
	SessionShot,
	SessionShotImage,
	TranscriptSegment,
} from "./sessionReport";
import { buildReportHtml, buildReportMarkdown, formatClock } from "./sessionReport";

export type SessionResult = {
	caseId: string;
	startedAt: number;
	durationMs: number;
	events: SessionEvent[];
	shots: SessionShot[];
	transcript: TranscriptSegment[];
	audio: Blob | null;
	audioExt: string; // "webm" | "mp4" — matches the recorder's mime
	micGranted: boolean;
};

// Minimal surface of the (non-standard) SpeechRecognition API we use.
type SpeechRecognitionLike = {
	continuous: boolean;
	interimResults: boolean;
	lang: string;
	onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
	onend: (() => void) | null;
	onerror: (() => void) | null;
	start: () => void;
	stop: () => void;
};

export class ReadingSession {
	readonly caseId: string;
	readonly startedAt = Date.now();
	events: SessionEvent[] = [];
	shots: SessionShot[] = [];
	transcript: TranscriptSegment[] = [];
	micGranted = false;

	private stream: MediaStream | null = null;
	private recorder: MediaRecorder | null = null;
	private chunks: BlobPart[] = [];
	private audioMime = "";
	private recognition: SpeechRecognitionLike | null = null;
	private stopped = false;

	private constructor(caseId: string) {
		this.caseId = caseId;
	}

	static async start(caseId: string): Promise<ReadingSession> {
		const session = new ReadingSession(caseId);
		await session.initAudio();
		session.initDictation();
		return session;
	}

	get elapsedMs(): number {
		return Date.now() - this.startedAt;
	}

	/**
	 * Append a timeline event. With coalesceMs > 0, a burst of same-type events
	 * (slice scrubbing, slider drags) collapses into one line that keeps the
	 * latest detail, instead of flooding the timeline.
	 */
	log(type: string, detail: string, coalesceMs = 0) {
		if (this.stopped) return;
		const t = this.elapsedMs;
		const last = this.events[this.events.length - 1];
		if (coalesceMs > 0 && last && last.type === type && t - last.t < coalesceMs) {
			last.detail = detail;
			last.t = t;
			return;
		}
		this.events.push({ t, type, detail });
	}

	addShot(label: string, images: SessionShotImage[]) {
		if (this.stopped || !images.length) return;
		this.shots.push({ t: this.elapsedMs, label, images });
	}

	async stop(): Promise<SessionResult> {
		this.stopped = true;
		try {
			this.recognition?.stop();
		} catch {
			/* recognition may already be stopped */
		}
		this.recognition = null;

		let audio: Blob | null = null;
		if (this.recorder && this.recorder.state !== "inactive") {
			const recorder = this.recorder;
			await new Promise<void>((resolve) => {
				recorder.onstop = () => resolve();
				try {
					recorder.stop();
				} catch {
					resolve();
				}
			});
		}
		if (this.chunks.length) {
			audio = new Blob(this.chunks, { type: this.audioMime || "audio/webm" });
		}
		this.stream?.getTracks().forEach((track) => track.stop());
		this.stream = null;
		this.recorder = null;

		return {
			caseId: this.caseId,
			startedAt: this.startedAt,
			durationMs: this.elapsedMs,
			events: this.events,
			shots: this.shots,
			transcript: this.transcript,
			audio,
			audioExt: this.audioMime.includes("mp4") ? "mp4" : "webm",
			micGranted: this.micGranted,
		};
	}

	private async initAudio() {
		try {
			if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return;
			this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) =>
				MediaRecorder.isTypeSupported?.(m)
			);
			this.recorder = mime ? new MediaRecorder(this.stream, { mimeType: mime }) : new MediaRecorder(this.stream);
			this.audioMime = this.recorder.mimeType || mime || "audio/webm";
			this.recorder.ondataavailable = (e) => {
				if (e.data && e.data.size > 0) this.chunks.push(e.data);
			};
			this.recorder.start(1000);
			this.micGranted = true;
		} catch {
			// Mic denied/unavailable — record an events-only session.
			this.stream?.getTracks().forEach((track) => track.stop());
			this.stream = null;
			this.micGranted = false;
		}
	}

	private initDictation() {
		if (!this.micGranted) return;
		const w = window as unknown as {
			SpeechRecognition?: new () => SpeechRecognitionLike;
			webkitSpeechRecognition?: new () => SpeechRecognitionLike;
		};
		const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
		if (!SR) return;
		try {
			const rec = new SR();
			rec.continuous = true;
			rec.interimResults = false;
			rec.lang = navigator.language || "en-US";
			rec.onresult = (e) => {
				for (let i = e.resultIndex; i < e.results.length; i++) {
					const r = e.results[i];
					const text = r?.[0]?.transcript?.trim();
					if (r?.isFinal && text) this.transcript.push({ t: this.elapsedMs, text });
				}
			};
			// The engine stops itself after silence; keep it running for the session.
			rec.onend = () => {
				if (this.stopped) return;
				try {
					rec.start();
				} catch {
					/* restart raced with a manual stop */
				}
			};
			rec.onerror = () => {
				/* fail soft — audio recording still runs */
			};
			rec.start();
			this.recognition = rec;
		} catch {
			this.recognition = null;
		}
	}
}

export function downloadBlob(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

export function downloadText(text: string, filename: string, mime = "text/plain") {
	downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

// Stitch per-pane screenshots into one image (for the toolbar snapshot button
// outside of a session, where one file beats three separate downloads).
export async function composeImagesSideBySide(images: SessionShotImage[]): Promise<string | null> {
	const loaded = await Promise.all(
		images.map(
			(im) =>
				new Promise<HTMLImageElement | null>((resolve) => {
					const img = new Image();
					img.onload = () => resolve(img);
					img.onerror = () => resolve(null);
					img.src = im.dataUrl;
				})
		)
	);
	const valid = loaded.filter((img): img is HTMLImageElement => !!img && img.width > 0);
	if (!valid.length) return null;
	const height = Math.max(...valid.map((img) => img.height));
	const gap = 4;
	const width = valid.reduce((w, img) => w + img.width, 0) + gap * (valid.length - 1);
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	ctx.fillStyle = "#000";
	ctx.fillRect(0, 0, width, height);
	let x = 0;
	for (const img of valid) {
		ctx.drawImage(img, x, 0);
		x += img.width + gap;
	}
	return canvas.toDataURL("image/png");
}

const dataUrlBase64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(",") + 1);

/**
 * Bundle everything from the session into one zip: the narration audio, the
 * machine-readable event timeline, every screenshot, and the draft report
 * (markdown + self-contained HTML). jszip is imported lazily so the viewer
 * bundle doesn't pay for it unless a bundle is actually downloaded.
 */
export async function buildSessionBundle(
	result: SessionResult,
	measurements: ReportMeasurement[]
): Promise<Blob> {
	const { default: JSZip } = await import("jszip");
	const zip = new JSZip();

	const reportInput = {
		caseId: result.caseId,
		startedAt: result.startedAt,
		durationMs: result.durationMs,
		events: result.events,
		shots: result.shots,
		transcript: result.transcript,
		measurements,
	};
	zip.file("report.md", buildReportMarkdown(reportInput));
	zip.file("report.html", buildReportHtml(reportInput));
	zip.file(
		"events.json",
		JSON.stringify(
			{
				caseId: result.caseId,
				startedAt: new Date(result.startedAt).toISOString(),
				durationMs: result.durationMs,
				micGranted: result.micGranted,
				events: result.events,
				transcript: result.transcript,
				measurements,
				screenshots: result.shots.map((s) => ({
					t: s.t,
					label: s.label,
					files: s.images.map((im) => shotFileName(s, im)),
				})),
			},
			null,
			2
		)
	);
	if (result.audio) zip.file(`narration.${result.audioExt}`, result.audio);
	for (const shot of result.shots) {
		for (const im of shot.images) {
			zip.file(`screenshots/${shotFileName(shot, im)}`, dataUrlBase64(im.dataUrl), { base64: true });
		}
	}
	return zip.generateAsync({ type: "blob" });
}

function shotFileName(shot: SessionShot, im: SessionShotImage): string {
	const clock = formatClock(shot.t).replace(/:/g, "m") + "s";
	const slug = shot.label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40);
	return `${clock}_${slug || "shot"}_${im.name}.png`;
}
