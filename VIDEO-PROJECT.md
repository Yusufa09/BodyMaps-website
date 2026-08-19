# BodyMaps Launch Video — Project Documentation

> ### ⚠ Superseded for the shoot
>
> The live documents are **[`launch-video-v2.md`](launch-video-v2.md)** (the 3:02
> advertisement cut, no voiceover) and **[`SHOOT-CHECKLIST.md`](SHOOT-CHECKLIST.md)**
> (everything to do before rolling). This file predates the rewrite — its runtime,
> VO, beat list and `cards.html` key mapping are all out of date.
>
> Still good here: the environment/tunnel recovery steps, the `?hd=1` rule, and
> the "keep off camera" hazards.

Complete state of the video project. Written to be pasted into a fresh
conversation with no prior context.

---

## 1. What this is

Yusuf, student researcher at Johns Hopkins on **BodyMaps** — a medical CT
imaging platform. Repo `PanTS-Viewer`, local path
`~/Documents/GitHub/BodyMaps-website`. Every team member must produce a
**~3-minute video demoing the whole website** for a milestone announcement.
Review session **Aug 21**; rough draft to the professor by **Aug 15**.
The professor cited **Apple product-launch films** and asked to balance visual
polish with feature coverage.

**Concept — "One Scan":** go all the way into a single scan (case 17), then pull
back to reveal 36,390. The cold open and the closing wall are bookends.

**Hero case: 17** (`PanTS_00000017`) — 52M, non-contrast CT colonography,
`shape [484,344,219]` (219 axial slices, 1,047 across all three planes),
25 organ meshes, impression `"Enlarged pancreas."`, `pancreas: status "check"`,
`tumor: 0`.

---

## 2. Where the shoot actually is

**Shot and in hand: everything through compare. Runtime 2:19.**

Remaining to shoot:

| Block | Planned | Notes |
|---|---|---|
| Wall + closing type | ~12–26s | Route was just rewritten; see §5 |
| Volume rendering (proposed) | ~12s | Not yet shot, not yet in script |

**Reading session (was 2:08–2:20) is CUT** by decision — don't re-add it.
**Share beat (was 2:04) is CUT** — the app gives no visible confirmation, so
there was nothing to film.

Projected final runtime **≈2:45–2:55** depending on the wall and whether the
volume beat goes in.

---

## 3. Environment — currently DOWN, restore before anything

Both the tunnel and the dev server have died since the last session.

```bash
# 1. JHU VPN must be connected first (Ivanti Secure Access).
#    bdmap1.wse.jhu.edu is internal-only DNS — if it doesn't resolve, you're off VPN.
dig +short bdmap1.wse.jhu.edu          # expect 10.99.65.166

# 2. Tunnel (keepalives matter — it has died twice)
(nohup ssh -N -o BatchMode=yes -o ServerAliveInterval=30 \
  -L 8000:127.0.0.1:8000 visitor@bdmap1.wse.jhu.edu > /tmp/tunnel.log 2>&1 &)
curl -s http://localhost:8000/api/ping   # expect {"message":"pong"}

# 3. Dev server
cd PanTS-Demo && (nohup ./node_modules/.bin/vite --port 5173 --strictPort > /tmp/vite.log 2>&1 &)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/api/ping   # expect 200
```

`PanTS-Demo/.env.development.local` must contain:

```
VITE_API_BASE=http://localhost:5173
VITE_PROXY_TARGET=http://localhost:8000
```

**`VITE_API_BASE` must be absolute.** Relative makes the Cornerstone loader
throw `Failed to construct 'URL'` and the viewer hangs on "PREPARING CASE".

**Sign-in:** OAuth from localhost always bounces to production, because the
backend builds `redirect_uri` from `PUBLIC_BASE_URL` (hardcoded to
`https://bodymaps.wse.jhu.edu`). Use **"Continue with email"** in the modal —
email/password goes straight through the proxy and the cookie lands on
localhost.

**Assets on disk (survive losing server access):**
`PanTS-Demo/public/thumbs/` 1,200 tiles + manifest ·
`PanTS-Demo/public/meshes/17/` 25 GLBs + manifest ·
`~/Desktop/test-scan.nii.gz` (43 MB).

**Production** `https://bodymaps.wse.jhu.edu` is up, rebranded, and a valid
alternative for product blocks — it has real data and shows a real URL. The
capture routes exist only on the demo branch, so those stay on localhost.

---

## 4. Repo state

Branch **`demo/cinematic-capture`**, last commit `5c1442d`.

**Uncommitted work in progress (not mine — yours from the last session):**

| File | Change |
|---|---|
| `src/routes/WallPage.tsx` | **+563 lines** — substantial rewrite, see §5 |
| `src/helpers/scriptedAnswers.ts` | **NEW** — scripted AI assistant, see §6 |
| `src/components/AIAssistant/AISidebar.tsx` | +24 — wires the scripted replies |
| `src/routes/Homepage/constants.ts` | 11 lines |
| `src/routes/CinematicPage.tsx` | 6 lines |
| `launch-video-vo.md` | 72 lines — your script edits |

Nothing here is committed. Typecheck/tests were last green at `5c1442d`;
**they have not been run against the uncommitted work.**

Other docs on the branch: `launch-video-vo.md` (script), `SHOOT-HANDOFF.md`
(earlier handoff — partly superseded by this file), `BRANDING.md`.

---

## 5. The wall was rewritten

`WallPage.tsx` now does the closing shot **and** carries the closing type over
it — the separate card-3 shot may no longer be needed.

```
/wall?hero=17&cols=41&local=1&hold=3000
```

Params: `hero n cols pool hold zoom scroll accel herofade outro decel rest
scrim readyms settle overscan`. Defaults `cols=41`, `pool=48`, `hold=1500`,
`zoom=4500`, `scroll=260`, `accel=7000`, `outro=20000`, `decel=4500`,
`rest=0.12`, `scrim=0.78`.

Two behaviours worth knowing, both documented in the file's own header:

- **`pool` caps distinct thumbnails (48) and repeats them** to fill the grid,
  because every-slot-unique meant thousands of fetches and decoded bitmaps.
  At 60–95px during a pull-back the repetition isn't perceptible. `pool=0`
  loads every tile.
- **Do not pre-warm the wall in a background tab.** `requestAnimationFrame` and
  `decode()` are both suspended in hidden tabs, so a wall warmed in a tab you
  aren't looking at sits frozen on the hero and looks broken. This contradicts
  the general "pre-warm everything" advice — the wall is the exception.

If it still reads as clunky, the old escape hatches remain: `scroll=0` removes
the accelerating scroll, `filter=0` removes the cohort re-flow (which is also
where hero 17 vanishes, since it is `tumor: 0`).

---

## 6. ⚠ BLOCKING — invented numbers in `scriptedAnswers.ts`

A new capture-only file plays a **fixed AI-assistant reply** so the beat is
repeatable, gated behind `?script=1` (`/case/8854?hd=1&script=1`). Its own
header carries this warning, repeated here because it is the one open item that
can actually cause harm:

> **The values in `FACTS` are placeholders.** The only verified fact about case
> 8854 is that `public/thumbs/manifest.json` records it as `tumor: 1`. Organ,
> lesion size, volume and HU were **not** verified.

**Before shooting that beat, open case 8854's real report and replace every
value.** Shipping invented measurements about a real case into a film shown to
clinicians is the failure mode that matters here.

Practical obstacle: **case 8854's report takes ~41 seconds to generate and is
not cached** (measured twice: 43.8s, then 41.0s). Case 17's returns in under a
second. Budget for that when you go to read the real values.

Also relevant if 8854 is being considered further: its impression is
`["Enlarged pancreas."]` — **identical to case 17** — and `lesions: {}` is
empty despite the tumour flag, so there is no lesion to show.

---

## 7. Shot list (current URLs)

Everything takes **~20 seconds to first paint**. Arm, wait until it actually
appears, *then* roll. Two false "it's broken" calls in the last session came
from sampling too early.

| Block | URL |
|---|---|
| Cold open | `/cinematic/17?local=1&start=liver&hold=1800&step=320&speed=2.0` |
| Cards | `/cards.html` — `1`/`2`/`3`, `R` replays |
| Library | `/dashboard` |
| Upload | `/upload` (needs sign-in) |
| Viewer | `/case/17?hd=1` |
| Report | report icon in the viewer toolbar |
| Compare | `/compare-viewer?a=17&b=44` |
| Wall | `/wall?hero=17&cols=41&local=1&hold=3000` |

`?hd=1` matters — without it the app serves `?res=low` whenever the server is
reachable, so having the tunnel up makes the picture *worse*.

**Single-organ bookend shot** (for a launch-style ending): `hold` gates when the
second organ appears, so a large value holds on the first one indefinitely —
`/cinematic/17?local=1&start=liver&hold=60000&speed=0.5`.

`/cinematic` also takes `margin=` (framing; **1.0 renders nothing**, the near
plane clips) and `minVertices=` (drops stray specks).

---

## 8. Verified app behaviour

- **Windowing** — six presets: Soft Tissue, Bone, Lung, Liver, Brain, **Angio**.
  Angio is the vessel window.
- **Cine** — press **`V`**. The toolbar button does nothing; the tooltip says
  "Cine controls (V to play)". ~1 slice/sec, so dragging the slider is faster.
- **Measurement** — Distance (mm), Bidirectional, Angle, HU at point,
  Rect/Ellipse/Freehand ROI with HU & area, Arrow, Magnify loupe. Shortcuts
  **L B A P R E F T G**. Use the shortcuts on camera, not the menu.
- **Mask editing** — Brush, Erase, Scissors, Level Tracing, Margin, Smoothing,
  Islands, Logical operators, Grow from seeds, Fill between slices, Copy across
  slices, Hollow.
- **Report** — three steps: "Your scan looks mostly healthy · 16 organs healthy,
  1 finding" → **Patient/Doctor** selector → "FINDING 1 OF 1 — Pancreas" with a
  measurements panel.
- **Volume rendering** — the 3D pane's **Meshes / Volume** toggle. Volume has
  its own presets: **Bone, Angio, Chest, Lung, Soft tissue, MIP**. Visually the
  strongest thing in the app; takes ~18s to render. **Not yet in the script.**
- **Organs are unchecked on load** — click **"Toggle all"** or the overlays and
  3D pane are empty. `?organs=all` exists but only lights the axial pane.

---

## 9. Known bugs — plan around these

1. **`NaN` on screen in the report.** The measurements panel reads
   `Mean HU · 47 · Report value: 47.2 +/- NaN`. The report text below it
   correctly says `47.2 +/- 38.5`. It sits in the frame the report beat points
   at. Fix or frame out. **Highest priority.**
2. **Hover-to-name does not exist.** No tooltip on 2D or 3D. Naming lives in
   the organ list ("Jump to aorta", "Jump to celiac artery"). The script already
   reflects this.
3. **Share gives no visible confirmation** — no toast, URL unchanged. Beat cut.
4. **Reading session never started** — probably waiting on Chrome's native mic
   permission dialog. Beat cut.
5. **Inference run never executed.** If it fails, the upload block drops.
6. **The report walkthrough moves the crosshair** and drops overlays on the
   finding step — coronal lands on femur at `321/344`. Re-centre between takes.

---

## 10. Keep off camera

- **"32,768 CASES MATCH"** on `/dashboard`. The API reports `total = 32768` —
  exactly 2¹⁵, a search index cap. The VO says 36,390 eight seconds earlier.
- **Organ-stats artifact rows**, all labelled "normal": `pancreas_body`
  `mean_hu -804.4` with **volume 184.1 cc against a whole pancreas of 31.02 cc**
  (a sub-part six times its parent), and `common_bile_duct -715.6`.
  `lung_right -802` is legitimate — lungs are air.
- **The URL bar on localhost** — anything that surfaces `localhost:5173`.

---

## 11. Open decisions

**The ending.** Current closing card reveals four things in sequence (stats →
wordmark → URL → institution) — that is a credits slate, not a launch ending,
and the stats are said three times across the film. Proposed instead:

1. Wall pulls back and **stops completely**, hold ~2s with music sustaining.
2. Hard cut to black, **~0.8s of actual silence**.
3. Cut to the single liver rotating (the cold-open image, via `hold=60000`).
4. Wordmark resolves over it.
5. URL fades in beneath, small.
6. End on the held frame.

Not yet implemented; `cards.html` would need trimming to a two-beat card, which
means re-shooting that one card.

**Volume rendering** — proposed as a ~12s beat after the windowing beat at 0:56,
since volume presets rhyme with the 2D window presets. Suggested line:
*"The same scan, rendered whole. Bone. Vessels. Or every bright thing at once."*
("Every bright thing at once" is MIP.) Not yet shot.

---

## 12. Recording practice

**Audio first, separately — never at the same time as picture.** Record the VO
straight through, then perform picture against it.

Order: capture routes early (they run off local disk and survive the tunnel
dropping), product blocks after. Roll 2–3 seconds before and after every beat
for handles. Reset between takes rather than salvaging.

Setup: DND on, clean browser profile at 1920×1080, Screen Studio auto-zoom
**off** for `cinematic`/`wall`/`cards`, **on** for product blocks.

Script lives in **`launch-video-vo.md`** — treat that file as the source of
truth for wording; it has been edited by hand since it was generated.
