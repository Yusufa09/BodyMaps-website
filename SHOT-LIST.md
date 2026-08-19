# BodyMaps launch video — clip-by-clip shooting directions

Film order, 31 clips, 3:02. Companion to `launch-video-v2.md` (the cut) and
`SHOOT-CHECKLIST.md` (what to fix and prepare first).

---

## Before the first clip

```bash
dig +short bdmap1.wse.jhu.edu        # 10.99.65.166, or you're off VPN
curl -s http://localhost:8000/api/ping        # {"message":"pong"}
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/api/ping   # 200
```

**Universal rules — every clip below assumes these:**

| | |
|---|---|
| Capture | 1920×1080, clean browser profile, fullscreen (Cmd-Ctrl-F), DND on |
| Handles | **Roll 3s before and 3s after** every listed duration. Roll times below already include them |
| Cursor | Park it off-screen or outside the crop whenever it isn't performing the action. The reference has **zero** cursor |
| Auto-zoom | Screen Studio auto-zoom **OFF** for cards, cinematic and wall. **ON** for product blocks |
| Tab focus | Keep the capture tab focused. `requestAnimationFrame` is suspended in background tabs — cards freeze, the wall sits frozen on the hero |
| Retakes | Reset and re-roll. Never salvage a bad take by trimming |
| Viewer URLs | Always `?hd=1`, or the app serves `?res=low` while the tunnel is up |

**Two clips share one continuous take.** Clips 11–21 are one unbroken `/case/17`
session — **do not reload between them**, it costs 40s and loses the warm volume.
Clips 25–28 are one unbroken wall run.

---

# OPENING — 0:00–0:22

## Clip 01 · 0:00 · 10s → roll 16s
**Cinematic assembly build**

- **URL** `/cinematic/17?local=1&start=liver&hold=1800&step=320&speed=2.0`
- **Setup** Load, wait ~20s for first paint. The liver must be visibly rotating
  before you arm. Auto-zoom OFF.
- **Action** Arm the recording → press **R** → let it run 16s without touching
  anything. The liver holds alone 1.8s, then structures step in every 320ms,
  building outward to 23. Lungs are excluded by design (truncated by the top of
  the volume, they read as broken geometry).
- **Frame** Full frame, no crop. This is a full-bleed shot.
- **Keep out** Cursor, browser chrome.
- **Check** 23 structures present at rest; no stray specks. If specks appear, add
  `&minVertices=200` and re-roll.
- **Note** Keep rolling past 16s — clip 02 needs the settled assembly and it's
  cheaper to get both in one take.

## Clip 02 · 0:10 · 8s · **BASE LAYER** → roll 14s
**Assembly at rest, slow rotate**

- **Source** Same take as clip 01, continued. If you stopped, re-roll clip 01 and
  keep going.
- **Action** Nothing. Let the settled assembly rotate untouched for 14s.
- **Frame** Full frame.
- **Check** Rotation is smooth and continuous, no hitch where the build ended.

## Clip 02b · 0:10 · 8s · **OVERLAY** → roll 14s
**Card 1 — the three figures**

- **URL** `/cards.html?overlay=1`
- **Action** Press **1** → arm → press **R**. Figures count up 350ms apart:
  36,390 · 145 · 993K · 32.
- **Frame** Full frame, black ground.
- **Composite** In CapCut: lay above clip 02, **Blend → Screen**.
- **Check** Ground reads pure black, not navy. If navy, you're missing
  `?overlay=1` and the blend will lift the whole picture.

## Clip 03 · 0:18 · 4s → roll 10s
**Card 2 — "Introducing / BodyMaps"**

- **URL** `/cards.html`
- **Action** Press **2** → arm → press **R**. "Introducing" fades in, then the
  wordmark resolves through it at 420ms. **This card fades — it does not type.**
- **Frame** Full frame, `--ink` ground.
- **Check** Both lines reach full opacity and hold. Ground matches clip 02's ink
  so the cut has no seam.

---

# THE LIBRARY — 0:22–0:33

## Clip 04 · 0:22 · 3s → roll 9s
**Card 3 — "Browse the dataset."**

- **URL** `/cards.html` · press **3** → arm → **R**
- **Check** Types on fully and holds. ~360ms to complete at 30 chars/sec.

## Clip 05 · 0:25 · 8s → roll 14s
**Dashboard grid scroll**

- **URL** `/dashboard`
- **Setup** Scroll down **past the header first**, so the case counter is already
  off-screen when you arm. Auto-zoom ON.
- **Action** Slow, even scroll through the thumbnail grid for 14s. One continuous
  motion — no acceleration, no stopping.
- **Frame** Crop to the grid alone, edge to edge. No header, no sidebar, no
  browser chrome.
- **Keep out** **"32,768 CASES MATCH"** — you flagged this as not an issue, but
  the crop should still favour grid-only for the texture read. Cursor.
- **Check** No partial rows at the crop edges at the start or end of the clip.

---

# UPLOAD — 0:33–1:00

> ⚠ This whole block depends on inference, which has **never been executed**.
> Test it end to end before shooting clips 07–10. If it fails, drop clips 09–10,
> and change card 4 to "Upload your own." — do **not** cut to case 17 and let it
> read as the file you uploaded.

## Clip 06 · 0:33 · 4s → roll 10s
**Card 4 — "Upload a scan. It comes back labeled."**

- **URL** `/cards.html` · press **4** → arm → **R**
- **Check** Longest card in the set — takes ~1.5s to complete. Let it finish
  before you stop rolling.

## Clip 07 · 0:37 · 6s → roll 12s
**File drag onto the drop zone**

- **URL** `/upload` (needs sign-in — use **"Continue with email"**; OAuth bounces
  to production)
- **Setup** Finder window with `~/Desktop/test-scan.nii.gz` positioned so the drag
  is a short, straight move. Auto-zoom ON.
- **Action** Drag the file onto the drop zone, release, let the filename and size
  resolve. Then park the cursor off-screen.
- **Frame** Crop to the drop zone card only.
- **Keep out** Finder window in the final crop, cursor after the drop lands.
- **Check** Filename and 43 MB both visible and settled.

## Clip 08 · 0:43 · 3s → roll 9s
**Card 5 — "Clinical-grade models."**

- **URL** `/cards.html` · press **5** → arm → **R**

## Clip 09 · 0:46 · 7s → roll 13s
**Model dropdown**

- **Setup** Continue from clip 07's state — file already staged.
- **Action** Open the model dropdown → hold 2s with the options readable →
  select one → let the menu close and the selection settle. Park the cursor.
- **Frame** Crop to the dropdown and its menu.
- **Keep out** Cursor once the selection is made.
- **Check** Options are legible at the crop size. If they're too small, this beat
  needs auto-zoom pushed harder.

## Clip 10 · 0:53 · 7s → roll long, then speed-ramp
**Inference run → labeled result**

- **Action** Start the run. **Roll continuously through the entire run**, however
  long it takes. Do not stop and restart.
- **Edit** Speed-ramp the wait down to ~5s in CapCut, then play the moment the
  labeled result appears at normal speed.
- **Frame** Crop to the progress indicator, then to the result.
- **Check** **The labeled output must be visible on screen.** This shot is the
  entire claim of card 4. If there's no visible labeling, the beat is unpaid —
  fall back per the warning above.

---

# THE VIEWER — 1:00–1:33
### Clips 11–21 are ONE continuous session. Do not reload.

## Clip 11 · 1:00 · 9s → roll 15s
**Viewer opens, organ cascade**

- **URL** `/case/17?hd=1`
- **Setup** Load and wait the full ~40s for the volume. **Click "Toggle all"** or
  the overlays and 3D pane stay empty. Auto-zoom ON.
- **Action** With everything loaded, capture the three MPR panes populating and
  the organ cascade playing out. If the cascade has already finished by the time
  you're rolling, toggle all off and on again to replay it.
- **Frame** Crop to the three MPR panes as a group.
- **Keep out** Cursor, toolbar, browser chrome.
- **Check** All three panes are populated; 3D pane is not empty.

## Clip 12 · 1:09 · 3s → roll 9s
**Card 6 — "Three planes. Three dimensions."**

- **URL** `/cards.html` · press **6** → arm → **R**
- **Note** Shoot this later with the other cards; it's listed here for film order.

## Clip 13 · 1:12 · 9s → roll 15s
**Crosshair travel**

- **Action** Drag the crosshair slowly and continuously across the axial pane.
  All three panes should track it and the 3D pane should orient with them. One
  smooth move — no stops, no direction changes.
- **Frame** Crop tight enough that the cursor reads as motion rather than as
  someone operating a tool.
- **Check** All three panes track together, no lag or desync.
- **Reset** Re-centre the crosshair before the next clip.

## Clip 14 · 1:21 · 3s · **OVERLAY** → roll 9s
**Card 7 — "32 structures, labeled."**

- **URL** `/cards.html?overlay=1` · press **7** → arm → **R**
- **Frame** Full frame, black ground. Sits in the **lower third** in overlay mode.
- **Composite** Blend → Screen over the viewer footage.
- **Check** Black ground, and the line sits low in frame, not centred.

## Clip 15 · 1:24 · 9s → roll long, trim
**Volume rendering** — never shot before

- **Action** In the 3D pane, switch **Meshes → Volume**. Wait the full ~18s
  render. Then step through presets, ending on **MIP**.
- **Edit** Trim to the best 9s. The render wait is not in the cut.
- **Frame** Full-bleed on the 3D pane. No type over this one.
- **Check** This is the strongest image in the app — if it looks muddy, try other
  presets (Bone, Angio, Chest) before settling.

---

# MEASUREMENT — 1:33–1:52
### Still the same session. Still no reload.

## Clip 16 · 1:33 · 6s → roll 12s
**Distance line**

- **Action** Press **L** (distance) — use the keyboard shortcut, **not** the menu,
  so no menu opens on camera. Draw one clean line across a structure. Let the mm
  readout settle. Park the cursor.
- **Frame** Crop to the line and its readout.
- **Check** Readout is legible at crop size and shows a sane value.

## Clip 17 · 1:39 · 6s → roll 12s
**ROI with HU and area**

- **Action** Press **R** (rect ROI) or **E** (ellipse). Draw one region. Let HU
  and area resolve. Park the cursor.
- **Frame** Crop to the ROI and its stats box.
- **Keep out** Any organ-stats row showing `pancreas_body` (184.1 cc against a
  whole pancreas of 31.02 cc) or `common_bile_duct` (−715.6 HU). Both are
  labelled "normal" and both are wrong.

## Clip 18 · 1:45 · 7s → roll 13s
**Organ list jump**

- **Action** Click one entry in the organ list ("Jump to aorta", "Jump to celiac
  artery"). All three MPR panes re-centre on it.
- **Frame** Crop to include both the list entry and at least one pane, so the
  cause and effect are in the same shot.
- **Check** The re-centre is visible — if the panes barely move, pick a structure
  further from the current crosshair position.

---

# THE REPORT — 1:52–2:14

## Clip 19 · 1:52 · 3s → roll 9s
**Card 8 — "Every case comes with a report."**

- **URL** `/cards.html` · press **8** → arm → **R**

## Clip 20 · 1:55 · 9s → roll 15s
**Report timeline**

- **Action** Open the report from the viewer toolbar. Capture the timeline
  animating node by node, ending with the pancreas row flagging amber.
- **Frame** Crop to the timeline.
- **Check** The amber flag is clearly visible — it's what motivates the next clip.

## Clip 21 · 2:04 · 10s → roll 16s
**Finding selected**

- **Action** Select the finding. Highlights appear on the scan.
- **Frame** **Crop must exclude the measurements panel** — it reads
  `47.2 +/- NaN`. Verify the crop before you move on; this is the highest-priority
  framing constraint in the film.
- **Keep out** The `NaN`. The measurements panel entirely, to be safe.
- **Check** Re-open the crop in CapCut and confirm no `NaN` at any point in the
  clip, including during the highlight animation.
- **Reset** The report walkthrough moves the crosshair and drops overlays —
  coronal lands on femur at 321/344. **Re-centre before any retake.**

---

# COMPARE — 2:14–2:29

## Clip 22 · 2:14 · 3s → roll 9s
**Card 9 — "Two scans. One scroll."**

- **URL** `/cards.html` · press **9** → arm → **R**

## Clip 23 · 2:17 · 12s → roll 18s
**Linked scroll**

- **URL** `/compare-viewer?a=17&b=44`
- **Setup** Slowest load in the film — it reuses case 17's volume from cache, so
  shoot this **after** the viewer block, never before. Wait for all six canvases.
- **Action** Scroll slowly and continuously through the slice range. Both cases
  move together. One unbroken motion for the full 18s.
- **Frame** Crop to both case panes side by side — the whole point is that they
  move as one, so both must be in frame.
- **Check** No desync between the two sides at any point.

---

# ENDING — 2:29–3:02

## Clip 24 · 2:29 · 3s → roll 9s
**Card 10 — "That was one scan."**

- **URL** `/cards.html` · press **10** (type both digits) → arm → **R**
- **Note** Full-frame cut, **not** an overlay — Screen blend can't darken, and
  this would otherwise sit over a bright CT tile with no way to scrim behind it.

## Clips 25–28 · 2:32–2:56 · 24s → **ONE TAKE**, roll 30s
**Wall: hero tile → pull-back → accelerate → rest**

- **URL** `/wall?hero=17&cols=41&local=1&hold=3000&outro=0`
- **Setup** **Do NOT pre-warm this in a background tab** — `rAF` and `decode()`
  are suspended when hidden, and it will sit frozen on the hero looking broken.
  Load it in the focused tab, watch it become ready, then arm. Auto-zoom OFF.
- **`outro=0` matters** — it suppresses the wall's own closing slate, which would
  otherwise fire before clip 31 and say the same thing twice.
- **Action** Arm → let it run 30s untouched. Four beats in one continuous move:
  case 17's tile fills frame (3s) → pull-back, grid resolves (9s) → scroll
  accelerates (8s) → comes to rest (4s).
- **Frame** Full frame, no crop.
- **Keep out** Any type. **No numbers over the wall** — the figures were stated
  once at 0:10 and the wall is their proof, not a restatement.
- **Check** Hero 17 lands dead centre. If the pull-back reads as clunky:
  `scroll=0` removes the accelerating scroll, `filter=0` removes the cohort
  re-flow (which is also where hero 17 vanishes, since it's `tumor: 0`).

## Clip 29 · 2:56 · 1s
**Black + silence** — made in the edit, nothing to shoot. Hard cut, ~0.8s of
actual silence with the music stopped, not faded.

## Clip 30 · 2:57 · 4s · **BASE LAYER** → roll 12s
**Single liver returns**

- **URL** `/cinematic/17?local=1&start=liver&hold=60000&speed=0.5`
- **Setup** `hold=60000` gates the second organ, so the liver holds alone
  indefinitely. `speed=0.5` slows the rotation for the ending.
- **Action** Arm → **R** → let it rotate 12s untouched.
- **Frame** Full frame. Must match clip 01's framing — it's the same image
  returning.
- **Check** No second structure appears. If one does, raise `hold`.

## Clip 31 · 3:01 · — · **OVERLAY** → roll 12s
**Card 11 — closing**

- **URL** `/cards.html?overlay=1` · press **11** → arm → **R**
- **Action** Wordmark fades in, URL resolves beneath at 900ms. **Fades, does not
  type.** Hold on the final frame.
- **Composite** Blend → Screen over clip 30.
- **Check** Black ground. Wordmark and URL only — **no figures**, no institution
  line. Both were deliberately removed.

---

## Card capture — do these first, all in one sitting

All 11 cards run off local disk with no server and no VPN, so nothing can fail.
Shoot them before anything else and bank the whole type layer.

| Clip | Key | Mode | Reveal |
|---|---|---|---|
| 02b | 1 | `?overlay=1` | count-up |
| 03 | 2 | cut | **fade** |
| 04 | 3 | cut | type |
| 06 | 4 | cut | type |
| 08 | 5 | cut | type |
| 12 | 6 | cut | type |
| 14 | 7 | `?overlay=1` | type, lower third |
| 19 | 8 | cut | type |
| 22 | 9 | cut | type |
| 24 | 10 | cut | type |
| 31 | 11 | `?overlay=1` | **fade** |

Shoot the 8 cut-mode cards from `/cards.html` in one pass, then reload at
`/cards.html?overlay=1` and shoot the 3 overlay cards. Don't mix — the ground
colour is the only difference and it's easy to lose track of which you captured.

---

## Order to actually shoot in

Film order is how it cuts, not how it shoots. Recommended sequence:

1. **All 11 cards** — local, cannot fail, banks the entire type layer
2. **Clips 01–03, 30** — cinematic, local disk, survives the tunnel dropping
3. **Clips 25–28** — wall, local disk
4. **Clip 05** — dashboard
5. **Clips 11–21** — the whole viewer block in ONE continuous session
6. **Clip 23** — compare, immediately after, while case 17 is still cached
7. **Clips 07–10** — upload and inference **last**, least certain

If the tunnel dies, steps 1–3 are already in hand and nothing is lost.
