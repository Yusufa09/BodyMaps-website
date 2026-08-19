# BodyMaps launch video — pre-shoot checklist

Everything standing between now and a complete shoot of the 3:02 cut in
`launch-video-v2.md`. Ordered so nothing blocks anything below it.

---

## A. Blockers — false or broken things that would reach the screen

| # | Item | Where | Fix |
|---|---|---|---|
| A1 | ~~Three different structure counts~~ **FIXED** — the figures are gone from both endings entirely (§3a), so the film states them once, on card 1 | — | Remaining: can you **source** the `993K` on card 1? |
| A2 | `NaN` in the report measurements panel — `47.2 +/- NaN` | 2:17 beat | Crop excludes it; verify the crop actually does |
| ~~A3~~ | ~~"32,768 CASES MATCH"~~ — **dismissed by decision**, left alone |  |  |
| A4 | Organ-stats artifact rows: `pancreas_body` 184.1 cc against a whole pancreas of 31.02 cc; `common_bile_duct` −715.6 HU. Both labelled "normal" | viewer | Keep off camera |
| A5 | Report walkthrough moves the crosshair and drops overlays on the finding step — coronal lands on femur at 321/344 | 2:17 beat | Re-centre between takes |

**Still open on A1:** card 1 shows four figures (`36,390` · `145` · `993K` ·
`32 classes per scan`) while the script describes three. Decide whether the
fourth stays.

---

## B. Never executed — prove these work before building shots around them

| # | Item | Risk if it fails |
|---|---|---|
| B1 | **The inference run.** Never once executed | Kills 0:33–1:00 — 27s, ~15% of the film. "It comes back labeled" has no payoff without the labeled result on screen |
| B2 | **Volume rendering** (Meshes→Volume, MIP). ~18s to render | Loses 12s and the best-looking shot in the app |
| B3 | **The wall route** — rewritten (+563 lines), never captured. Check `outro=0` suppresses the built-in slate and hero 17 lands centre | Loses the entire ending |
| B4 | **Model dropdown** — never shot; confirm it opens and what the options say | Loses 0:43–0:53 |
| B5 | **`cards.html` on localhost** — all my checks ran over `file://`, so the webfont is unproven and the pane's screenshot disagreed with the DOM geometry | Type renders in the wrong font or wrong position |
| B6 | **`npm install` first — `node_modules` is incomplete.** `@types/*` packages are missing their `index.d.ts`, so `tsc -b` fails with ~10 × TS6053 before it reaches any real code. Then run `npm run typecheck && npm test`. Never run since `5c1442d` | Typecheck cannot run at all until deps are reinstalled |

If B1 fails, the honest fallback is to cut the claim to "Upload your own." and end
the block at the model picker. Do **not** cut to case 17 and let it read as the
file you just uploaded.

---

## C. The cursor problem — decide before you re-shoot anything

The reference has **no cursor in 51 seconds**, and the v2 cut is built on that.
Your existing footage was shot full-window with the cursor visible and moving.

- Cropping removes it wherever the cursor sits outside the cropped panel.
- It does **not** remove it from interaction beats — drawing a measurement,
  dragging the crosshair — where the cursor is at the action point.

So decide per beat: re-shoot with the cursor hidden where the action still reads
(organ cascade, report timeline, compare scroll), or accept a visible cursor on
the beats that genuinely need one. **Existing footage is not a drop-in reuse for
the v2 framing** — treat "reuse" as optimistic until you've looked at each crop.

---

## D. Still to capture

**Type cards — 11 total, two modes** (`launch-video-v2.md` §6):
- 8 in cut mode: `/cards.html`
- 3 in overlay mode: `/cards.html?overlay=1` — cards **1, 7, 11**

**New footage:**
- Volume rendering (~9s in the cut)
- Wall, with `outro=0`
- Model dropdown open + selection
- Inference run through to a labeled result

**Re-crop or re-shoot** (see §C): dataset grid, upload drag, viewer core,
crosshair, measurement, organ list, report, compare.

---

## E. What you need

**Software**
- **CapCut** — has Blend → Screen, which is what the 4 overlays need. Nothing to buy. (DaVinci Resolve is the free step up if CapCut frustrates you.)
- **Screen Studio** — capture. Auto-zoom **off** for cards / cinematic / wall, **on** for product blocks.
- Clean browser profile at 1920×1080, fullscreen (Cmd-Ctrl-F), DND on.

**A music bed — not yet sourced. Now the single largest dependency**, because the
voiceover is cut and music is the entire soundtrack. It needs a **clear, steady
pulse**: the reference has no sound effects at all, and every bit of its snap
comes from cutting the type reveals onto the beat (measured: ~0.95s median, a
repeating 1.05/1.05/0.90/0.65/0.55 pattern). A track with a vague ambient wash
gives you nothing to cut to. Must be licensed for a public university video.

**Assets — all confirmed present**
- `~/Desktop/test-scan.nii.gz` (43 MB)
- `PanTS-Demo/public/thumbs/` — 1,200 tiles + manifest
- `PanTS-Demo/public/meshes/17/` — 25 GLBs + manifest

**Access**
- JHU VPN (Ivanti Secure Access) — required; `bdmap1` is internal-only DNS
- Signed in on localhost via **"Continue with email"** (OAuth bounces to
  production because the backend builds `redirect_uri` from `PUBLIC_BASE_URL`)

---

## F. Day-of environment, in order

```bash
# 1. VPN first — if this doesn't resolve, you're off VPN
dig +short bdmap1.wse.jhu.edu          # expect 10.99.65.166

# 2. Tunnel (keepalives matter — it has died twice)
(nohup ssh -N -o BatchMode=yes -o ServerAliveInterval=30 \
  -L 8000:127.0.0.1:8000 visitor@bdmap1.wse.jhu.edu > /tmp/tunnel.log 2>&1 &)
curl -s http://localhost:8000/api/ping   # expect {"message":"pong"}

# 3. Dev server
cd PanTS-Demo && (nohup ./node_modules/.bin/vite --port 5173 --strictPort > /tmp/vite.log 2>&1 &)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/api/ping   # expect 200
```

`PanTS-Demo/.env.development.local` must hold — **`VITE_API_BASE` absolute**, or
the Cornerstone loader throws `Failed to construct 'URL'` and the viewer hangs on
"PREPARING CASE":

```
VITE_API_BASE=http://localhost:5173
VITE_PROXY_TARGET=http://localhost:8000
```

**Pre-warm** `/case/17?hd=1` first (compare reuses its volume from cache), then
`/compare-viewer`, then the rest. Everything takes ~20s to first paint — arm,
wait for it to appear, *then* roll. Never reload a warm tab; `/case/17` costs 40s.

**Never pre-warm the wall in a background tab**, and keep the tab focused when
capturing cards — `requestAnimationFrame` and `decode()` are suspended in hidden
tabs, so both freeze and then jump instead of animating.

`?hd=1` on every viewer URL, or the app serves `?res=low` whenever the server is
reachable — having the tunnel up makes the picture *worse* without it.

---

## G. Shooting order

1. **Type cards** — pure local, no server, no VPN. Do these first; they can't fail.
2. **Capture routes** — cinematic, wall. Local disk, survive the tunnel dropping.
3. **Product blocks** — viewer core in one continuous session (don't reload) →
   report → compare.
4. **Upload + inference last** — least certain, and if it fails you've already
   banked everything else.

Roll 2–3 seconds before and after every beat for handles. Reset between takes
rather than salvaging.

---

## H. Decisions still open

| Decision | Options |
|---|---|
| ~~Voiceover~~ | **DECIDED — none.** Type + music only |
| **Card 15 vs the wall's own slate** | `WallPage.tsx` composites a closing slate in code with a real scrim — better than any blend, but it lands over the wall, not the returning liver. Use one or the other, never both |
| **Card 1's fourth stat** | Script says three figures; the card has four |
| **`scriptedAnswers.ts`** | The AI-assistant beat is **not in the v2 cut**. It's wired into `AISidebar.tsx` but gated behind `?script=1` so it can't fire by accident. Either drop it or leave it dormant — but don't shoot it without replacing the placeholder FACTS with case 8854's real report values |
