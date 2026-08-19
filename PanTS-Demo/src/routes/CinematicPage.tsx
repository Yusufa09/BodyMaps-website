// Capture-only route for the launch video (branch: demo/cinematic-capture).
//
// Renders the case's 3D meshes full-bleed on black with no chrome, no cursor and
// no controls, so a screen recording of this page is usable footage as-is. The
// "assemble" shot is driven here: one organ is held alone, then the rest fade in
// one at a time.
//
//   /cinematic/17?start=liver&hold=1800&step=320&speed=2.0
//
// Every knob is a query param so the shot can be retuned on the day without a
// rebuild. Press R to replay the reveal without reloading.
//
// This route is not linked from anywhere in the UI — it exists to be recorded.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { SegmentationMeshViewer, fetchMeshManifest } from "../components/viewer/MeshViewer";
import type { MeshManifest, OrganMeshInfo } from "../types";

/** Read a numeric query param, falling back when absent or unparseable. */
function num(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Read a 0/1 query param. */
function flag(params: URLSearchParams, key: string, fallback: boolean): boolean {
  const raw = params.get(key);
  if (raw === null) return fallback;
  return raw !== "0" && raw !== "false";
}

/**
 * Order the organs for the reveal: the "start" organ first (matched on key or
 * name, case-insensitive), then the rest largest-first so the body builds from
 * its bulk inwards rather than popping in at random.
 */
function revealOrder(organs: OrganMeshInfo[], start: string): OrganMeshInfo[] {
  const wanted = start.trim().toLowerCase();
  const isStart = (o: OrganMeshInfo) =>
    o.key?.toLowerCase() === wanted || o.name?.toLowerCase() === wanted;

  const head = organs.filter(isStart);
  const tail = organs
    .filter((o) => !isStart(o))
    .sort((a, b) => (b.vertices ?? 0) - (a.vertices ?? 0));

  return [...head, ...tail];
}

export default function CinematicPage() {
  const { caseId = "" } = useParams();
  const [params] = useSearchParams();

  const start = params.get("start") ?? "liver";
  const holdMs = num(params, "hold", 1800);
  const stepMs = num(params, "step", 320);
  const speed = num(params, "speed", 2.0);
  const opacity = num(params, "opacity", 100);
  const rotate = flag(params, "rotate", true);
  const reveal = flag(params, "reveal", true);
  const isSession = flag(params, "session", false);
  const useLocal = flag(params, "local", false);
  // Bounds fit leaves the body off-centre and small in frame at the default
  // 1.2. Tunable here so framing can be dialled in against a real monitor
  // without a rebuild — below ~1 the near plane starts cutting the geometry.
  const margin = num(params, "margin", 1.2);
  // Drop segmentation islands smaller than this many vertices (see below).
  const minVertices = num(params, "minVertices", 0);

  const [manifest, setManifest] = useState<MeshManifest | null>(null);
  const [visibleIds, setVisibleIds] = useState<Set<number>>(new Set());
  // Bumped by the R key to restart the reveal between takes.
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    let alive = true;

    // local=1 reads the manifest written by scripts/download-meshes.mjs, whose
    // organ urls already point into public/meshes — so the whole shot runs off
    // disk with no backend, no tunnel and no Cloudflare in the path.
    const load = useLocal
      ? fetch(`/meshes/${caseId}/manifest.json`).then((r) => {
          if (!r.ok) throw new Error(`no local manifest (${r.status}) — run scripts/download-meshes.mjs`);
          return r.json() as Promise<MeshManifest>;
        })
      : fetchMeshManifest(caseId, isSession);

    load
      .then((data) => {
        if (alive) setManifest(data);
      })
      .catch((err) => console.error("cinematic: manifest failed", err));

    return () => {
      alive = false;
    };
  }, [caseId, isSession, useLocal]);

  // Drop organs from the shot by key or name, comma-separated. The default hides
  // the lungs: this is an abdominal scan, so they're truncated by the top of the
  // volume and the cut edge reads as broken geometry when the mesh fills a frame.
  const excluded = useMemo(() => {
    const raw = params.get("exclude") ?? "lung_left,lung_right";
    return new Set(
      raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    );
  }, [params]);

  const organs = useMemo(() => {
    if (!manifest?.organs) return null;
    return manifest.organs.filter(
      (o) =>
        !excluded.has((o.key ?? "").toLowerCase()) &&
        !excluded.has((o.name ?? "").toLowerCase()) &&
        // Tiny segmentation islands render as a speck of colour floating away
        // from the body — on a full-bleed black frame that reads as a dead
        // pixel or dust on the lens. Drop them rather than paint them out.
        (o.vertices ?? Infinity) >= minVertices,
    );
  }, [manifest, excluded, minVertices]);

  const ordered = useMemo(
    () => (organs ? revealOrder(organs, start) : []),
    [organs, start],
  );

  // Drive the assemble: start organ alone for holdMs, then one more every stepMs.
  useEffect(() => {
    if (!ordered.length) return;

    if (!reveal) {
      setVisibleIds(new Set(ordered.map((o) => o.id)));
      return;
    }

    setVisibleIds(new Set(ordered.length ? [ordered[0].id] : []));

    const timers = ordered.slice(1).map((organ, i) =>
      setTimeout(() => {
        setVisibleIds((prev) => new Set(prev).add(organ.id));
      }, holdMs + i * stepMs),
    );

    return () => timers.forEach(clearTimeout);
  }, [ordered, reveal, holdMs, stepMs, runId]);

  const replay = useCallback((e: KeyboardEvent) => {
    if (e.key === "r" || e.key === "R") setRunId((n) => n + 1);
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", replay);
    return () => window.removeEventListener("keydown", replay);
  }, [replay]);

  // MeshViewer indexes checkState by organ id, so the array has to be long enough
  // to hold the highest id rather than just the organ count.
  const checkState = useMemo(() => {
    if (!organs?.length) return [];
    const size = Math.max(...organs.map((o) => o.id)) + 1;
    return Array.from({ length: size }, (_, id) => visibleIds.has(id));
  }, [organs, visibleIds]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        // --ink from styles/brand.css. Hard-coded rather than var() because this
        // route renders full-bleed with no app shell, and the cut from here to
        // the title card is seamless only if both grounds are the same value.
        background: "#0F172A",
        cursor: "none",
        // MeshViewer renders a plain "Loading 3D segmentation…" string before its
        // own manifest fetch resolves. Nothing else on this route draws text, so
        // making text invisible keeps that out of the recording.
        color: "transparent",
      }}
    >
      {manifest && (
        <SegmentationMeshViewer
          caseId={caseId}
          checkState={checkState}
          loading={false}
          opacity={opacity}
          crosshairMm={null}
          isSession={isSession}
          autoRotate={rotate}
          autoRotateSpeed={speed}
          cinematic
          boundsMargin={margin}
          // Hand over the manifest we already have so the viewer doesn't refetch —
          // required in local mode, where there is no API to fetch from.
          manifestOverride={manifest}
        />
      )}
    </div>
  );
}
