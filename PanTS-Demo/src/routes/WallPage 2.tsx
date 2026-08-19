// Capture-only route for the launch video (branch: demo/cinematic-capture).
//
// The closing shot: start filled by the hero case's own thumbnail, pull back to
// reveal it as one tile in a wall of real dataset scans, then scroll — accelerating
// — before a filter lands and the wall re-flows to the matching cohort.
//
//   /wall?hero=17&n=1200&local=1
//
// Every tile is a real thumbnail from /api/get_image_preview, so nothing here is
// composited or faked. Run scripts/download-thumbs.mjs first and pass local=1:
// 1200 live requests mid-take will stutter and ruin the pull-back.
//
// Press R to replay. This route is not linked from anywhere in the UI.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { API_BASE } from "../helpers/constants";
import { itemToId, type CaseId, type SearchItem } from "../helpers/search";

type Tile = { id: CaseId; tumor: number | null };
type ManifestEntry = { file: string; tumor: number | null };

function num(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function flag(params: URLSearchParams, key: string, fallback: boolean): boolean {
  const raw = params.get(key);
  if (raw === null) return fallback;
  return raw !== "0" && raw !== "false";
}

const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export default function WallPage() {
  const [params] = useSearchParams();

  const heroId = params.get("hero") ?? "";
  const count = num(params, "n", 1200);
  const cols = num(params, "cols", 40);
  const holdMs = num(params, "hold", 1500);
  const zoomMs = num(params, "zoom", 4500);
  const scrollPxPerSec = num(params, "scroll", 260);
  const accelMs = num(params, "accel", 7000);
  const filterAtMs = num(params, "filter", 14000);
  const useLocal = flag(params, "local", false);

  const [tiles, setTiles] = useState<Tile[]>([]);
  const [manifest, setManifest] = useState<Record<string, ManifestEntry> | null>(null);
  const [loadedCount, setLoadedCount] = useState(0);
  const [filtered, setFiltered] = useState(false);
  const [runId, setRunId] = useState(0);

  const scaleRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Data ────────────────────────────────────────────────────────────────────
  // Local mode is fully offline: the manifest carries both the filenames and the
  // tumor flag, so the whole shot runs off disk with no backend at all. That
  // matters because the API is CORS-pinned — a locally served frontend can't
  // call the deployed backend without a server-side allowlist change.
  useEffect(() => {
    if (!useLocal) return;
    let alive = true;
    fetch("/thumbs/manifest.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no manifest"))))
      .then((data: Record<string, ManifestEntry>) => {
        if (!alive) return;
        setManifest(data);
        setTiles(
          Object.entries(data).map(([id, entry]) => ({
            id: /^\d+$/.test(id) ? Number(id) : id,
            tumor: entry.tumor ?? null,
          })),
        );
      })
      .catch(() =>
        console.warn("wall: /thumbs/manifest.json missing — run scripts/download-thumbs.mjs"),
      );
    return () => {
      alive = false;
    };
  }, [useLocal]);

  // API fallback: only when not running from disk.
  useEffect(() => {
    if (useLocal) return;
    let alive = true;
    fetch(`${API_BASE}/api/search?dataset=all&sort_by=quality&per_page=${count}`)
      .then((r) => {
        if (!r.ok) throw new Error(`search failed (${r.status})`);
        return r.json();
      })
      .then((data: { items?: SearchItem[] }) => {
        if (!alive) return;
        const mapped: Tile[] = (data.items ?? [])
          .map((it) => ({ id: itemToId(it), tumor: it.tumor ?? null }))
          .filter((t) => t.id !== 0);
        setTiles(mapped);
      })
      .catch((err) => console.error("wall: search failed", err));
    return () => {
      alive = false;
    };
  }, [count, useLocal]);

  // Hero goes dead-centre so the pull-back can originate from it.
  const ordered = useMemo(() => {
    if (!tiles.length) return [];
    const rest = tiles.filter((t) => String(t.id) !== heroId);
    const hero = tiles.find((t) => String(t.id) === heroId);
    if (!hero) return tiles;

    const rows = Math.ceil(tiles.length / cols);
    const centerIndex = Math.floor(rows / 2) * cols + Math.floor(cols / 2);
    const out = [...rest];
    out.splice(Math.min(centerIndex, out.length), 0, hero);
    return out;
  }, [tiles, heroId, cols]);

  const shown = useMemo(
    () => (filtered ? ordered.filter((t) => t.tumor === 1) : ordered),
    [ordered, filtered],
  );

  const srcFor = useCallback(
    (id: CaseId) => {
      const entry = manifest?.[String(id)];
      if (entry) return `/thumbs/${entry.file}`;
      return `${API_BASE}/api/get_image_preview/${id}`;
    },
    [manifest],
  );

  // Wait for most tiles to decode before moving — a pull-back across half-loaded
  // images is unusable footage.
  const ready = ordered.length > 0 && loadedCount >= Math.floor(ordered.length * 0.9);

  // ── Animation ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;

    const rows = Math.ceil(ordered.length / cols);
    const originX = ((Math.floor(cols / 2) + 0.5) / cols) * 100;
    const originY = ((Math.floor(rows / 2) + 0.5) / rows) * 100;
    if (scaleRef.current) scaleRef.current.style.transformOrigin = `${originX}% ${originY}%`;

    const zoomFrom = cols; // one tile fills the viewport width
    const start = performance.now();
    let frame = 0;
    setFiltered(false);

    const tick = (now: number) => {
      const t = now - start;

      // Phase 1/2: hold on the hero tile, then ease back out to the full wall.
      let scale = 1;
      if (t < holdMs) {
        scale = zoomFrom;
      } else if (t < holdMs + zoomMs) {
        scale = zoomFrom + (1 - zoomFrom) * easeInOutCubic((t - holdMs) / zoomMs);
      }
      if (scaleRef.current) scaleRef.current.style.transform = `scale(${scale})`;

      // Phase 3: scroll, ramping to full speed over accelMs. Integral of a linear
      // ramp, so the motion has no velocity jump when it reaches cruise.
      const scrollT = Math.max(0, t - (holdMs + zoomMs));
      const ramp = Math.min(1, scrollT / accelMs);
      const distance =
        (scrollPxPerSec / 1000) *
        (ramp < 1 ? (scrollT * ramp) / 2 : accelMs / 2 + (scrollT - accelMs));
      if (scrollRef.current) scrollRef.current.style.transform = `translateY(${-distance}px)`;

      // Phase 4: the cohort filter lands.
      if (filterAtMs > 0 && t >= filterAtMs) setFiltered(true);

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready, ordered.length, cols, holdMs, zoomMs, scrollPxPerSec, accelMs, filterAtMs, runId]);

  const replay = useCallback((e: KeyboardEvent) => {
    if (e.key === "r" || e.key === "R") setRunId((n) => n + 1);
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", replay);
    return () => window.removeEventListener("keydown", replay);
  }, [replay]);

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#050505", cursor: "none" }}>
      <div ref={scaleRef} style={{ width: "100%", height: "100%", willChange: "transform" }}>
        <div
          ref={scrollRef}
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: 2,
            willChange: "transform",
          }}
        >
          {shown.map((tile) => (
            <img
              key={String(tile.id)}
              src={srcFor(tile.id)}
              alt=""
              onLoad={() => setLoadedCount((n) => n + 1)}
              onError={() => setLoadedCount((n) => n + 1)}
              style={{
                width: "100%",
                aspectRatio: "1 / 1",
                objectFit: "cover",
                display: "block",
                background: "#0d0d0d",
              }}
            />
          ))}
        </div>
      </div>

      {filtered && (
        <div
          style={{
            position: "fixed",
            bottom: "8vh",
            left: "50%",
            transform: "translateX(-50%)",
            padding: "10px 22px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.16)",
            backdropFilter: "blur(20px)",
            color: "rgba(255,255,255,0.92)",
            font: "600 15px/1 Inter, system-ui, sans-serif",
            letterSpacing: "0.02em",
          }}
        >
          Tumor · {shown.length.toLocaleString("en-US")} scans
        </div>
      )}
    </div>
  );
}
