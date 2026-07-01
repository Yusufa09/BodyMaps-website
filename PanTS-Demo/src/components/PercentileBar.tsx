// Tiny inline sparkline for the Organ Statistics panel: a 0–100 percentile track with the
// "normal" p5–p95 band shaded and a marker at the case's percentile. Purely presentational
// — the x-axis IS the percentile, so the band is always 5%–95%. The marker turns amber in
// the tails to match the flagged number next to it.
type Props = {
	percentile: number; // 0–100
	flagged: boolean; // true when in the <p5 / >p95 tail
};

export default function PercentileBar({ percentile, flagged }: Props) {
	const left = Math.max(0, Math.min(100, percentile));
	return (
		<div
			className="vp-spark"
			role="img"
			aria-label={`Percentile ${Math.round(percentile)} of 100`}
		>
			<div className="vp-spark__band" />
			<div
				className={`vp-spark__marker${flagged ? " vp-spark__marker--flag" : ""}`}
				style={{ left: `${left}%` }}
			/>
		</div>
	);
}
