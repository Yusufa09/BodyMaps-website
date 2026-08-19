// Capture-only scripted assistant replies for the launch video.
// Branch: demo/cinematic-capture. DO NOT MERGE TO MAIN.
//
// The assistant needs the tunnel and a live model, and a real generation is
// non-deterministic — wrong length for the cut, different wording every take.
// This plays a fixed reply for one question on one case so the beat is
// repeatable, and streams it word by word so it looks like the real endpoint.
//
// Gated behind ?script=1 so it can never fire in ordinary use. Without the
// param every message goes to the server exactly as before.
//
//   /case/8854?hd=1&script=1
//
// ---------------------------------------------------------------------------
// !! THE NUMBERS BELOW ARE PLACEHOLDERS !!
//
// The only fact verified about case 8854 is that public/thumbs/manifest.json
// records it as tumor-positive (`"8854": { "tumor": 1 }`). Organ, size,
// volume and HU were NOT verifiable — the tunnel was down when this was
// written. Open case 8854's own report and replace every value in FACTS
// before shooting. Shipping invented measurements about a real case into a
// film shown to clinicians is the one failure mode here that actually matters.
// ---------------------------------------------------------------------------

/** Replace each value from case 8854's real report before recording. */
const FACTS = {
  organ: "pancreas",
  lesionSizeCm: "2.1",
  organVolumeCc: "—",
  organMeanHu: "—",
  healthyOrganCount: "16",
  structureCount: "32",
};

type ScriptedAnswer = { question: string; answer: string };

const SCRIPTS: Record<string, ScriptedAnswer> = {
  "8854": {
    // Typed on camera. Kept short so it doesn't take long to type in frame.
    question: "What stands out in this scan?",
    answer: [
      `This case is flagged tumor-positive. Of the ${FACTS.structureCount} structures segmented here, one is outside its reference range — the ${FACTS.organ}.`,
      ``,
      `**${FACTS.organ[0].toUpperCase()}${FACTS.organ.slice(1)}** — a lesion measuring roughly ${FACTS.lesionSizeCm} cm. Organ volume ${FACTS.organVolumeCc} cc, mean density ${FACTS.organMeanHu} HU.`,
      ``,
      `The other ${FACTS.healthyOrganCount} abdominal organs fall within range for this study, and the vessels and skeleton segment cleanly.`,
      ``,
      `Want me to jump to the ${FACTS.organ}, or open the full report?`,
    ].join("\n"),
  },
};

/** True when the URL carries ?script=1. Everything here is inert otherwise. */
export const scriptedAnswersEnabled = (): boolean => {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("script") === "1";
};

/** Loose match so the question doesn't have to be typed character-perfect on camera. */
const matches = (typed: string, target: string): boolean => {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const t = norm(typed);
  if (!t) return false;
  const words = norm(target).split(" ").filter((w) => w.length > 3);
  return words.every((w) => t.includes(w));
};

/** The scripted reply for this case and question, or null to fall through to the server. */
export const getScriptedAnswer = (caseId: string, typed: string): string | null => {
  if (!scriptedAnswersEnabled()) return null;
  const script = SCRIPTS[String(caseId)];
  if (!script) return null;
  return matches(typed, script.question) ? script.answer : null;
};

/**
 * Play the reply back word by word, mimicking the real stream endpoint. An
 * instantly-complete answer reads as fake on camera; this does not.
 */
export const playScriptedAnswer = async (
  answer: string,
  onChunk: (soFar: string) => void,
  signal?: AbortSignal,
): Promise<void> => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // Beat before the first token, so the "Thinking" state is visible.
  await wait(700);
  const tokens = answer.split(/(\s+)/);
  let soFar = "";
  for (const token of tokens) {
    if (signal?.aborted) return;
    soFar += token;
    onChunk(soFar);
    if (token.trim()) await wait(28 + Math.random() * 34);
  }
};
