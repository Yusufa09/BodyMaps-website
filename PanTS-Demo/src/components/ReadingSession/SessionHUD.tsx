import { IconCamera, IconMicrophone, IconMicrophoneOff } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { ReadingSession } from "../../helpers/readingSession";
import { formatClock } from "../../helpers/sessionReport";
import "./ReadingSession.css";

type Props = {
	session: ReadingSession;
	onSnapshot: () => void;
	onStop: () => void;
};

// Floating REC pill shown while a reading session records: elapsed time, live
// event/screenshot counts, a manual key-image button, and Stop.
function SessionHUD({ session, onSnapshot, onStop }: Props) {
	// The session mutates its own arrays; a light ticker keeps the pill current.
	const [, setTick] = useState(0);
	useEffect(() => {
		const id = window.setInterval(() => setTick((n) => n + 1), 500);
		return () => window.clearInterval(id);
	}, []);

	return (
		<div className="vp-rec" role="status" aria-label="Reading session recording">
			<span className="vp-rec__dot" aria-hidden="true" />
			<span className="vp-rec__title">REC</span>
			<span className="vp-rec__clock">{formatClock(session.elapsedMs)}</span>
			<span className="vp-rec__counts">
				{session.events.length} events · {session.shots.length} shots
			</span>
			<span className="vp-rec__mic" title={session.micGranted ? "Narration is being recorded" : "No microphone — events-only session"}>
				{session.micGranted ? <IconMicrophone size={14} /> : <IconMicrophoneOff size={14} />}
			</span>
			<button className="vp-rec__btn" onClick={onSnapshot} title="Capture key image (S)" aria-label="Capture key image">
				<IconCamera size={15} />
			</button>
			<button className="vp-rec__stop" onClick={onStop}>
				<span className="vp-rec__stopsquare" aria-hidden="true" />
				Stop
			</button>
		</div>
	);
}

export default SessionHUD;
