// Capture-only route for the launch video (branch: demo/cinematic-capture).
//
// The closing shot, now carrying the closing card too: start filled by the hero
// case's own thumbnail, pull back to reveal it as one tile in a wall of dataset
// scans, scroll — accelerating — then let the closing type resolve over the top
// while the wall slows to a near-stop underneath it.
//
//   /wall?hero=17&cols=41&local=1&hold=3000
//
// Press R to replay. This route is not linked from anywhere in the UI.
//
// ── On repeated tiles ───────────────────────────────────────────────────────
// `pool` caps how many DISTINCT thumbnails are loaded; the grid is filled by
// repeating them. Every slot unique meant thousands of requests through a
// six-deep HTTP/1.1 pipe and thousands of decoded bitmaps held at once. Repeats
// share one decode per distinct src, so 48 images cost 48 fetches however many
// slots they fill. Tiles are ~60-95px during a pull-back and an accelerating
// scroll; the repetition is not perceptible. Pass pool=0 to load every tile.
//
// ── Why the tiles are windowed, and why nothing mounts before decoding ─────
// `onLoad` is the wrong signal twice over: it fires when the bytes arrive, not
// when there is something paint-ready, and for a repeated src it fires per
// element off a cache hit. Gating on it cleared in milliseconds while the
// compositor still had thousands of tiles to rasterize, so the wall filled in
// visibly mid-shot. decode() resolves on a paint-ready bitmap and there are
// only `pool` of them — but it is deferred entirely in a background tab, hence
// the deadline race. Nothing here runs unattended: requestAnimationFrame is
// suspended in a hidden tab too, so a wall pre-warmed in a tab you are not
// looking at sits frozen on the hero and looks like it failed to load.
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

// Grid gutter, in px. Shared by the CSS below and the hero-centring maths
// above — they have to agree or the pull-back lands off by a few pixels
// per row, which compounds to whole tiles by row 30.
const GRID_GAP = 2;

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/**
 * How far the scroll travels by `end` ms, integrating the same velocity curve
 * the animation loop uses. Shared so the grid can be sized from the motion
 * rather than guessed at — a wall that runs out mid-shot puts bare ground under
 * the closing type, which is the one thing this shot cannot do.
 */
function scrollDistanceBy(
  end: number,
  o: { start: number; cruise: number; accel: number; outro: number; decel: number; rest: number },
): number {
  let d = 0;
  for (let ms = o.start; ms < end; ms += 16) {
    let v = o.cruise * Math.min(1, (ms - o.start) / o.accel);
    if (o.outro > 0 && ms > o.outro) {
      v *= 1 - (1 - o.rest) * easeOutCubic(Math.min(1, (ms - o.outro) / o.decel));
    }
    d += (v * 16) / 1000;
  }
  return d;
}

/**
 * Which pool entry fills grid slot `i`.
 *
 * A plain `i % poolSize` aligns with the grid whenever the two share a factor:
 * 20 columns against a 40-tile pool puts the same two images in every column,
 * top to bottom. Vertical stripes read as broken far more than repetition does.
 * A multiplicative hash scatters them with no such structure.
 */
const scatter = (i: number, poolSize: number): number =>
  (Math.imul(i + 1, 2654435761) >>> 0) % poolSize;

export default function WallPage() {
  const [params] = useSearchParams();

  const heroId = params.get("hero") ?? "";
  // Grid slots. Sized from the motion rather than guessed: the hero sits
  // half-way down, so only the rows *below* it are scroll runway, and a wall
  // that runs out leaves bare ground under the closing type. Always a whole
  // number of rows — a partial last row shows up as a lone stub of tiles at the
  // end of the scroll. Pass n= to override. Slots are cheap: they all come from
  // the same `pool`, so extra rows cost DOM nodes and no extra images.
  const explicitCount = params.get("n");
  // Forced odd. With an even column count the viewport centre lands on the
  // gutter *between* the two middle columns, so centring the hero needs an X
  // translation — and that translation has to be either held (leaving a bare
  // strip once the wall is at natural size) or eased away (which turns the
  // pull-back into a zoom plus a sideways drift, and the drift is what the eye
  // notices). An odd count puts a column dead centre and the whole problem
  // disappears: no offset, no gap, and a zoom that is purely a scale.
  const rawCols = num(params, "cols", 41);
  const cols = rawCols % 2 === 0 ? rawCols + 1 : rawCols;
  const poolSize = num(params, "pool", 48);
  const holdMs = num(params, "hold", 1500);
  const zoomMs = num(params, "zoom", 4500);
  const scrollPxPerSec = num(params, "scroll", 260);
  const accelMs = num(params, "accel", 7000);
  // The opening frame is a dedicated full-screen hero layer rather than the
  // grid's own tile scaled up. Two reasons, both visible on camera: the tile is
  // square and the screen is not, so scaling it to fill the width puts 22% of
  // the scan off the top and bottom; and thumbnails are 512px, so filling 1920
  // from the grid is a 3.75x upscale on the shot's first frame. The layer uses
  // object-fit: contain and fades out once the pull-back has shrunk the grid's
  // tile enough for the two to be indistinguishable. 0 = derive from zoomMs.
  const heroFadeMs = num(params, "herofade", 0);
  // When the closing type starts resolving, and how long the wall takes to ease
  // down to `restFraction` of cruise speed underneath it. The scroll never fully
  // stops — a dead-still final frame loses the sense of scale the motion carries.
  const outroAtMs = num(params, "outro", 20000);
  const decelMs = num(params, "decel", 4500);
  const restFraction = num(params, "rest", 0.12);
  const scrimOpacity = num(params, "scrim", 0.78);
  // Start anyway once this long has passed, however many tiles reported in. The
  // load gate is a quality guard, not a correctness one, and a shot that never
  // begins is worse than one that begins a few tiles short.
  const readyTimeoutMs = num(params, "readyms", 6000);
  // Beat between the tiles mounting and the first frame of motion, for the
  // compositor to rasterize them. Raise it if the wall still fills in on camera.
  const settleMs = num(params, "settle", 900);
  // Tiles kept alive beyond the viewport edge. Raise it if tiles still appear at
  // the edges of frame during the pull-back; lower it if the shot stutters.
  const overscan = num(params, "overscan", 3);
  const useLocal = flag(params, "local", false);

  const count = useMemo(() => {
    if (explicitCount !== null) {
      const parsed = Number(explicitCount);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tile = (vw - (cols - 1) * GRID_GAP) / cols;
    const pitch = tile + GRID_GAP;
    // Run the integral well past the outro: after it the scroll never stops, it
    // just eases to `rest`, so the shot can sit there while the type holds.
    const scrollStart = holdMs + zoomMs;
    const end = (outroAtMs > 0 ? outroAtMs : scrollStart + 15000) + decelMs + 40000;
    const travel = scrollDistanceBy(end, {
      start: scrollStart, cruise: scrollPxPerSec, accel: accelMs,
      outro: outroAtMs, decel: decelMs, rest: restFraction,
    });
    // runway = rows*pitch - heroOffsetY - vh, and heroOffsetY is about half the
    // grid, so solving for rows: rows >= 2*(travel + tile/2 + vh/2)/pitch.
    // Generously over-sized, on purpose. Each row only buys pitch/2 of runway —
    // the hero sits half-way down, so growing the grid pushes the start point
    // down with it — and reaching the end at all is visible twice over: the
    // clamp stops the scroll, and the bottom row sits half-cut at the frame
    // edge. Rows are nearly free (every one draws from the same `pool`, and the
    // window only ever mounts a few hundred tiles), so buy far more than the
    // arithmetic asks for and never think about it again.
    const needed = (2 * (travel + tile / 2 + vh / 2)) / pitch;
    const rows = Math.ceil(needed * 1.6) + 40;
    return rows * cols;
  }, [
    explicitCount, cols, holdMs, zoomMs, accelMs, scrollPxPerSec,
    outroAtMs, decelMs, restFraction,
  ]);

  const [tiles, setTiles] = useState<Tile[]>([]);
  const [manifest, setManifest] = useState<Record<string, ManifestEntry> | null>(null);
  const [decoded, setDecoded] = useState(false);
  const [settled, setSettled] = useState(false);
  const [waitedLongEnough, setWaitedLongEnough] = useState(false);
  const [outroOn, setOutroOn] = useState(false);
  const [runId, setRunId] = useState(0);

  const scaleRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  // Index -> element, kept across replays. A replay reuses tiles the
  // compositor has already painted; rebuilding them would undo the point.
  const tilesRef = useRef<Map<number, HTMLImageElement>>(new Map());

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

  // The distinct thumbnails actually fetched. The hero is forced in even if it
  // falls outside the pool slice, or the film's own case never loads at all.
  const pool = useMemo(() => {
    if (!tiles.length) return [];
    if (poolSize <= 0) return tiles;
    const hero = tiles.find((t) => String(t.id) === heroId);
    const rest = tiles.filter((t) => String(t.id) !== heroId).slice(0, poolSize - (hero ? 1 : 0));
    return hero ? [hero, ...rest] : rest;
  }, [tiles, poolSize, heroId]);

  const heroTile = useMemo(
    () => pool.find((t) => String(t.id) === heroId) ?? null,
    [pool, heroId],
  );

  // Fill `count` grid slots from the pool, hero dead-centre so the pull-back has
  // something to originate from.
  const ordered = useMemo(() => {
    if (!pool.length) return [];
    const slots = Math.min(count, poolSize <= 0 ? pool.length : count);
    const out: Tile[] = Array.from({ length: slots }, (_, i) => pool[scatter(i, pool.length)]);

    const hero = pool.find((t) => String(t.id) === heroId);
    // Falling back silently means the pull-back opens on an arbitrary case and the
    // shot still looks fine on a monitor — you only find out in the edit that the
    // film's one case never appears in its own closing reveal. Say so out loud.
    if (!hero) {
      if (heroId) {
        console.warn(
          `wall: no tile for hero "${heroId}" — the pull-back will start on some other case. ` +
            `Fetch it with: node scripts/download-thumbs.mjs --api <API> --ids ${heroId}`,
        );
      }
      return out;
    }

    const rows = Math.ceil(out.length / cols);
    const centerIndex = Math.floor(rows / 2) * cols + Math.floor(cols / 2);
    out[Math.min(centerIndex, out.length - 1)] = hero;
    return out;
  }, [pool, count, poolSize, heroId, cols]);

  const srcFor = useCallback(
    (id: CaseId) => {
      const entry = manifest?.[String(id)];
      if (entry) return `/thumbs/${entry.file}`;
      return `${API_BASE}/api/get_image_preview/${id}`;
    },
    [manifest],
  );

  // Decode every distinct source before a single tile mounts.
  //
  // `onLoad` was the wrong signal twice over: it fires when the bytes have
  // arrived, not when there is a bitmap ready to paint, and for a repeated src
  // it fires per element off a cache hit — so the gate cleared in milliseconds
  // while the compositor still had thousands of tiles to rasterize, and the
  // wall filled in visibly during the pull-back. decode() resolves on a
  // paint-ready bitmap, and there are only `pool` of them to wait for.
  useEffect(() => {
    if (!pool.length) return;
    let alive = true;
    setDecoded(false);
    // Raced against a deadline. decode() is deferred entirely while a tab is in
    // the background, so pre-warming the wall in a tab you aren't looking at
    // would otherwise leave it waiting forever on a promise the browser has no
    // intention of settling.
    Promise.race([
      Promise.all(
        pool.map((t) => {
          const img = new Image();
          img.src = srcFor(t.id);
          // A source that won't decode shouldn't hold the whole shot hostage.
          return img.decode().catch(() => undefined);
        }),
      ),
      new Promise((r) => setTimeout(r, readyTimeoutMs)),
    ]).then(() => {
      if (alive) setDecoded(true);
    });
    return () => {
      alive = false;
    };
  }, [pool, srcFor, readyTimeoutMs, runId]);

  // Settle beat between the bitmaps existing and the first frame of motion.
  useEffect(() => {
    if (!decoded) return;
    const id = window.setTimeout(() => setSettled(true), settleMs);
    return () => window.clearTimeout(id);
  }, [decoded, settleMs, runId]);

  useEffect(() => {
    if (!ordered.length) return;
    const id = window.setTimeout(() => setWaitedLongEnough(true), readyTimeoutMs);
    return () => window.clearTimeout(id);
  }, [ordered.length, readyTimeoutMs, runId]);

  // Never wait forever: a shot that starts a few tiles short beats one that
  // never starts at all.
  const ready = ordered.length > 0 && ((decoded && settled) || waitedLongEnough);

  // ── Animation ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;

    // Put the hero tile under the viewport centre and scale about that centre.
    //
    // Percentage transform-origin resolves against the scaling element's own
    // box — which is viewport-sized — while the grid inside it is ~60 rows and
    // overflows far below. Deriving the origin from the hero's row therefore
    // pointed at row ~5, and the pull-back opened on an arbitrary tile with the
    // hero thousands of pixels off-frame. Offsetting the grid instead is exact
    // at any column count, tile size or viewport.
    const rows = Math.ceil(ordered.length / cols);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const heroIndex = Math.min(
      Math.floor(rows / 2) * cols + Math.floor(cols / 2),
      ordered.length - 1,
    );

    // Tiles are absolutely positioned by this component rather than laid out by
    // `1fr`, so the geometry is exact floats — no whole-pixel column rounding to
    // compound over 48 rows, and nothing to measure back off the DOM.
    const tileSize = (vw - (cols - 1) * GRID_GAP) / cols;
    const pitch = tileSize + GRID_GAP;
    const heroOffsetX = (heroIndex % cols) * pitch + tileSize / 2 - vw / 2;
    const heroOffsetY = Math.floor(heroIndex / cols) * pitch + tileSize / 2 - vh / 2;

    // Zero by construction now that `cols` is odd — checked rather than assumed,
    // because if it stops being zero the symptom is a drifting pull-back, which
    // is easy to see and hard to attribute.
    if (Math.abs(heroOffsetX) > 1) {
      console.warn(
        `wall: hero column is ${heroOffsetX.toFixed(1)}px off centre — the zoom will drift.`,
      );
    }

    if (scaleRef.current) scaleRef.current.style.transformOrigin = "50% 50%";

    // Scale the hero tile to fill the viewport HEIGHT, not its width. The tiles
    // are square; filling a 16:9 width would make the tile 1920x1920 and crop
    // 44% of its height away. Filling the height lands it exactly where the
    // contain-fitted hero layer sits, so the cross-fade between them doesn't
    // shift the image. Derived from the real tile size, gap included.
    const zoomFrom = vh / tileSize;
    // Default: gone by the time the pull-back has taken the tile back under its
    // own native 512px, past which the grid is as sharp as the layer was.
    const heroFade = heroFadeMs > 0 ? heroFadeMs : zoomMs * 0.55;
    // Hard floor: never let the grid's bottom edge rise above the viewport.
    // The auto-sizer above should make this unreachable, but if a timing change
    // outruns it the scroll simply stops rather than sliding bare ground under
    // the closing type. A wall that stops moving is a far smaller problem than
    // a wall that isn't there.
    const maxDistance = Math.max(0, rows * pitch - GRID_GAP - heroOffsetY - vh);

    // ── Tile windowing ──────────────────────────────────────────────────────
    // Only tiles that are on screen exist in the DOM.
    //
    // This is the fix for the wall filling in on camera. With all of them
    // present, magnifying the subtree 12x made the compositor rasterize the
    // whole grid at that scale, which evicted everything it had already painted
    // — so coming back down to 1x it repainted from scratch, a band at a time,
    // in front of the lens. Pre-painting could not help: rasterized tiles are
    // scale-specific, so the work was thrown away by the zoom that followed.
    // Windowed, there are about four tiles alive at full zoom and nothing to
    // evict, and each one is rasterized once at a scale close to its own.
    const host = scrollRef.current;
    if (host) host.style.height = `${rows * pitch - GRID_GAP}px`;
    const mounted = tilesRef.current;
    const OVERSCAN = overscan; // beyond the edge, so none appears mid-frame

    const syncWindow = (scale: number, offsetY: number) => {
      if (!host) return;
      // Invert the transform to find which grid coordinates are on screen.
      const gx0 = vw / 2 + (0 - vw / 2) / scale;
      const gx1 = vw / 2 + (vw - vw / 2) / scale;
      const gy0 = vh / 2 + (0 - vh / 2) / scale + offsetY;
      const gy1 = vh / 2 + (vh - vh / 2) / scale + offsetY;

      const c0 = Math.max(0, Math.floor(gx0 / pitch) - OVERSCAN);
      const c1 = Math.min(cols - 1, Math.floor(gx1 / pitch) + OVERSCAN);
      const r0 = Math.max(0, Math.floor(gy0 / pitch) - OVERSCAN);
      const r1 = Math.min(rows - 1, Math.floor(gy1 / pitch) + OVERSCAN);

      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const i = r * cols + c;
          if (i >= ordered.length || mounted.has(i)) continue;
          const img = document.createElement("img");
          img.src = srcFor(ordered[i].id);
          img.alt = "";
          img.decoding = "sync";
          img.style.cssText =
            `position:absolute;left:${c * pitch}px;top:${r * pitch}px;` +
            `width:${tileSize}px;height:${tileSize}px;` +
            `object-fit:cover;display:block;background:#1B2436`;
          host.appendChild(img);
          mounted.set(i, img);
        }
      }
    };

    // Seed the opening frame before the first tick, so the hero is already
    // rasterized when the hold begins rather than appearing on frame two.
    syncWindow(zoomFrom, heroOffsetY);

    const start = performance.now();
    let last = start;
    let distance = 0;
    let frame = 0;
    setOutroOn(false);

    const tick = (now: number) => {
      const t = now - start;
      const dt = Math.min(now - last, 64); // clamp, so a dropped frame can't lurch
      last = now;

      // Phase 1/2: hold on the hero tile, then ease back out to the full wall.
      // 0 while held on the hero, 1 once the wall is at its natural size.
      const zoomP =
        t < holdMs ? 0 : easeInOutCubic(Math.min(1, (t - holdMs) / zoomMs));
      const scale = zoomFrom + (1 - zoomFrom) * zoomP;
      if (scaleRef.current) scaleRef.current.style.transform = `scale(${scale})`;

      // Hero layer holds through the beat, then hands off to the grid.
      if (heroRef.current) {
        const gone = t < holdMs ? 0 : Math.min(1, (t - holdMs) / heroFade);
        heroRef.current.style.opacity = String(1 - easeInOutCubic(gone));
      }

      // Phase 3/4: scroll ramps to cruise, then eases down to a residual drift as
      // the closing type resolves. Integrated per frame rather than solved in
      // closed form — with an ease in and an ease out the integral stops being
      // worth writing down, and velocity is the thing that has to stay smooth.
      const scrollT = t - (holdMs + zoomMs);
      let velocity = 0;
      if (scrollT > 0) {
        velocity = scrollPxPerSec * Math.min(1, scrollT / accelMs);
        if (outroAtMs > 0 && t > outroAtMs) {
          const down = Math.min(1, (t - outroAtMs) / decelMs);
          velocity *= 1 - (1 - restFraction) * easeOutCubic(down);
        }
      }
      distance = Math.min(distance + (velocity * dt) / 1000, maxDistance);
      if (scrollRef.current) {
        // Y only. X is fixed at 0, so the pull-back is a pure scale about a
        // fixed point and the frame never moves sideways. Y is constant through
        // the zoom too — `distance` stays 0 until the scroll phase begins.
        scrollRef.current.style.transform =
          `translateY(${-(heroOffsetY + distance)}px)`;
      }
      syncWindow(scale, heroOffsetY + distance);

      if (outroAtMs > 0 && t >= outroAtMs) setOutroOn(true);

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [
    ready, ordered.length, cols, holdMs, zoomMs, scrollPxPerSec, accelMs,
    heroFadeMs, outroAtMs, decelMs, restFraction, overscan, srcFor, ordered, runId,
  ]);

  const replay = useCallback((e: KeyboardEvent) => {
    if (e.key === "r" || e.key === "R") {
      setWaitedLongEnough(false);
      setRunId((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", replay);
    return () => window.removeEventListener("keydown", replay);
  }, [replay]);

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", background: "#0F172A", cursor: "none" }}>
      <div ref={scaleRef} style={{ width: "100%", height: "100%", willChange: "transform" }}>
        {/* Empty on purpose. Tiles are created imperatively as the window moves
            over them — see syncWindow. React never sees them: one element per
            visible tile, reconciled 60 times a second, is its own stall. */}
        <div ref={scrollRef} style={{ position: "relative", width: "100%", willChange: "transform" }} />
      </div>

      {/* The opening frame: the hero scan whole and correctly proportioned, on
          ink, rather than a 3.75x upscale of a square tile with its top and
          bottom cropped off by a 16:9 frame. Fades out into the grid's own
          hero tile, which the zoom lands in exactly the same place. */}
      {heroTile && (
        <div
          ref={heroRef}
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "#0F172A",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            willChange: "opacity",
          }}
        >
          <img
            src={srcFor(heroTile.id)}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
          />
        </div>
      )}

      {/* Closing card, over the still-moving wall. Type treatment and timings
          mirror card 3 in public/cards.html so the two are interchangeable. */}
      <style>{`
        @keyframes wall-rise {
          from { opacity: 0; transform: translateY(0.42em); filter: blur(7px); }
          to   { opacity: 1; transform: none; filter: none; }
        }
        .wall-outro > * { opacity: 0; }
        .wall-outro--on .wall-outro__mark  { animation: wall-rise 1200ms cubic-bezier(.22,.61,.36,1) 120ms forwards; }
        .wall-outro--on .wall-outro__url   { animation: wall-rise 1000ms cubic-bezier(.22,.61,.36,1) 900ms forwards; }
      `}</style>

      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: "#0F172A",
          opacity: outroOn ? scrimOpacity : 0,
          transition: "opacity 1100ms cubic-bezier(.22,.61,.36,1)",
          pointerEvents: "none",
        }}
      />

      <div
        className={`wall-outro${outroOn ? " wall-outro--on" : ""}`}
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
          color: "#F7F7F4",
          pointerEvents: "none",
        }}
      >
        <div
          className="wall-outro__mark"
          style={{
            fontSize: "clamp(48px, 9.5vw, 190px)",
            fontWeight: 600,
            letterSpacing: "-0.045em",
            lineHeight: 1,
          }}
        >
          BodyMaps
        </div>
        <div
          className="wall-outro__url"
          style={{
            marginTop: "clamp(14px, 2vh, 30px)",
            fontSize: "clamp(13px, 1.5vw, 30px)",
            fontWeight: 500,
            color: "#F7F7F4",
          }}
        >
          bodymaps.wse.jhu.edu
        </div>
      </div>
    </div>
  );
}
