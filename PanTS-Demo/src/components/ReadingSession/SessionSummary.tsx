import { IconDownload, IconFileText, IconMicrophone, IconPackage } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import {
	buildSessionBundle,
	downloadBlob,
	downloadText,
	type SessionResult,
} from "../../helpers/readingSession";
import {
	buildReportHtml,
	buildReportMarkdown,
	formatClock,
	type ReportInput,
	type ReportMeasurement,
} from "../../helpers/sessionReport";
import "./ReadingSession.css";

type Props = {
	result: SessionResult;
	measurements: ReportMeasurement[];
	onDiscard: () => void;
};

// Post-session dialog ("Reading session captured"): play back the narration,
// open the template-built draft report, download the full session bundle, or
// discard. Nothing leaves the browser.
function SessionSummary({ result, measurements, onDiscard }: Props) {
	const [showReport, setShowReport] = useState(false);
	const [bundling, setBundling] = useState(false);

	const reportInput: ReportInput = useMemo(
		() => ({
			caseId: result.caseId,
			startedAt: result.startedAt,
			durationMs: result.durationMs,
			events: result.events,
			shots: result.shots,
			transcript: result.transcript,
			measurements,
		}),
		[result, measurements]
	);
	const reportHtml = useMemo(() => (showReport ? buildReportHtml(reportInput) : ""), [showReport, reportInput]);

	const audioUrl = useMemo(
		() => (result.audio ? URL.createObjectURL(result.audio) : null),
		[result.audio]
	);
	useEffect(() => {
		return () => {
			if (audioUrl) URL.revokeObjectURL(audioUrl);
		};
	}, [audioUrl]);

	const downloadBundle = async () => {
		setBundling(true);
		try {
			const blob = await buildSessionBundle(result, measurements);
			downloadBlob(blob, `case${result.caseId}_reading-session.zip`);
		} finally {
			setBundling(false);
		}
	};

	if (showReport) {
		return (
			<div className="vp-session-backdrop" role="dialog" aria-label="Draft reading report">
				<div className="vp-report">
					<div className="vp-report__bar">
						<span className="vp-report__title">Draft report — case {result.caseId}</span>
						<div className="vp-report__actions">
							<button
								className="vp-session__btn"
								onClick={() => downloadText(reportHtml, `case${result.caseId}_report.html`, "text/html")}
							>
								<IconDownload size={15} /> HTML
							</button>
							<button
								className="vp-session__btn"
								onClick={() =>
									downloadText(buildReportMarkdown(reportInput), `case${result.caseId}_report.md`, "text/markdown")
								}
							>
								<IconDownload size={15} /> Markdown
							</button>
							<button className="vp-session__close" onClick={() => setShowReport(false)} aria-label="Back to session summary">
								×
							</button>
						</div>
					</div>
					<iframe className="vp-report__frame" title="Draft reading report" srcDoc={reportHtml} />
				</div>
			</div>
		);
	}

	return (
		<div className="vp-session-backdrop" role="dialog" aria-label="Reading session captured">
			<div className="vp-session">
				<div className="vp-session__head">
					<span className="vp-session__micbadge">
						<IconMicrophone size={18} />
					</span>
					<div className="vp-session__headtext">
						<div className="vp-session__title">Reading session captured</div>
						<div className="vp-session__sub">
							{formatClock(result.durationMs)} · {result.events.length} events · {result.shots.length} screenshots
							{result.transcript.length > 0 && <> · {result.transcript.length} dictation segments</>}
						</div>
					</div>
					<button className="vp-session__close" onClick={onDiscard} aria-label="Close and discard session">
						×
					</button>
				</div>

				{audioUrl ? (
					<audio className="vp-session__audio" controls src={audioUrl} />
				) : (
					<div className="vp-session__noaudio">
						No narration audio was recorded{result.micGranted ? "." : " (microphone unavailable or denied)."}
					</div>
				)}

				{result.transcript.length > 0 && (
					<div className="vp-session__transcript">
						{result.transcript.slice(0, 3).map((seg, i) => (
							<div key={i}>
								<span className="vp-session__t">[{formatClock(seg.t)}]</span> {seg.text}
							</div>
						))}
						{result.transcript.length > 3 && (
							<div className="vp-session__more">…and {result.transcript.length - 3} more in the report</div>
						)}
					</div>
				)}

				<div className="vp-session__actions">
					<button className="vp-session__btn vp-session__btn--primary" onClick={() => setShowReport(true)}>
						<IconFileText size={16} /> Open draft report
					</button>
					<button className="vp-session__btn" onClick={downloadBundle} disabled={bundling}>
						<IconPackage size={16} /> {bundling ? "Zipping…" : "Download session bundle"}
					</button>
				</div>

				<div className="vp-session__foot">
					<button className="vp-session__discard" onClick={onDiscard}>
						Discard session
					</button>
					<span>The bundle contains the audio, event timeline, screenshots and the draft report.</span>
				</div>
			</div>
		</div>
	);
}

export default SessionSummary;
