# BodyMaps Launch Video — Shoot Handoff

> ### ⚠ Superseded for the shoot
>
> The live documents are **[`launch-video-v2.md`](launch-video-v2.md)** (the 3:02
> advertisement cut, no voiceover) and **[`SHOOT-CHECKLIST.md`](SHOOT-CHECKLIST.md)**
> (everything to do before rolling). This file predates the rewrite — its runtime,
> VO, beat list and `cards.html` key mapping are all out of date.
>
> Still good here: the environment/tunnel recovery steps, the `?hd=1` rule, and
> the "keep off camera" hazards.

Everything needed to record. Written at the end of a long prep session; every
claim below was verified in real Chrome unless marked otherwise.

---

## Context

Yusuf, student researcher at Johns Hopkins on **BodyMaps** (repo `PanTS-Viewer`,
local path `~/Documents/GitHub/BodyMaps-website`). Each team member must produce
a ~3-minute video demoing the whole website for a milestone announcement.
Review session **Aug 21**; rough draft to the professor by **Aug 15**.
The professor cited Apple product-launch films and asked to **balance visual
polish with feature coverage**.

**Concept — "One Scan":** go all the way into a single scan (case 17), then pull
back to reveal 36,390. Cold open and library reveal are bookends.

---

## Environment state

| Thing | State |
|---|---|
| Branch | `demo/cinematic-capture` @ `5c1442d`, working tree **clean** |
| Vite | Running on `:5173` |
| Tunnel | Up — `ssh -N -L 8000:127.0.0.1:8000 visitor@bdmap1.wse.jhu.edu` returns `pong` |
| `.env.development.local` | `VITE_API_BASE=http://localhost:5173`, `VITE_PROXY_TARGET=http://localhost:8000` |
| Assets | `public/thumbs/` 1,200 tiles + manifest · `public/meshes/17/` 25 GLBs + manifest |
| Test scan | `~/Desktop/test-scan.nii.gz` (43 MB) |
| Production | `https://bodymaps.wse.jhu.edu` — up, rebranded, signed in |
| Auth | Signed in on **both** localhost and production |

**If the tunnel dies** (it has, twice — now started with keepalives):

```bash
(nohup ssh -N -o BatchMode=yes -o ServerAliveInterval=30 -L 8000:127.0.0.1:8000 visitor@bdmap1.wse.jhu.edu > /tmp/tunnel.log 2>&1 &)
curl -s http://localhost:8000/api/ping
```

**If the viewer hangs on "PREPARING CASE"** — check `.env.development.local`.
`VITE_API_BASE` must be absolute; the Cornerstone loader throws
`Failed to construct 'URL'` on a relative one.

---

## Shot list

Everything takes **~20 seconds to first paint**. Arm, wait for it to appear,
*then* roll. Two false "it's broken" calls came from sampling too early.

| Block | URL | Notes |
|---|---|---|
| Cold open 0:00 | `/cinematic/17?local=1&start=liver&hold=1800&step=320&speed=2.0` | `R` replays. Local, no server. `margin=` tunes framing (**1.0 renders nothing** — near plane clips). `minVertices=` drops stray specks. |
| Cards 0:09 / 0:12 / 2:46 | `/cards.html` | `1`/`2`/`3`, `R` replays. Local. |
| Library 0:20 | `/dashboard` | **Frame out "32,768 CASES MATCH"** — see hazards. |
| Upload 0:26 | `/upload` | Needs sign-in. Drag `~/Desktop/test-scan.nii.gz`. |
| Viewer 0:38–1:34 | `/case/17?hd=1` | Click **"Toggle all"** or organs are unchecked and the 3D pane is empty. |
| Report 1:34–1:56 | Report icon in viewer toolbar | Three-step walkthrough. |
| Compare 1:56 | `/compare-viewer?a=17&b=44` | Two full-res volumes; slowest load. |
| Reveal 2:20 | `/wall?hero=17&n=1200&cols=20&local=1` | `R` replays. Hero at index 610, dead centre. Local. |

**Pre-warm order:** `/case/17?hd=1` first (compare reuses its volume from cache),
then `/compare-viewer`, then the rest. Never reload a warm tab — `/case/17` costs
40 seconds.

`?hd=1` matters: without it the app serves `?res=low` whenever the server is
reachable, so having the tunnel up makes the picture *worse*.

---

## Verified working

- **Windowing** — six presets: Soft Tissue, Bone, Lung, Liver, Brain, **Angio**.
- **Cine** — press **`V`**. The toolbar button does nothing. ~1 slice/sec.
- **Scrub** — dragging the slice slider is faster than cine.
- **Measurement** — Distance (mm), Bidirectional, Angle, HU at point, Rect /
  Ellipse / Freehand ROI with HU & area, Arrow, Magnify loupe. Shortcuts:
  **L B A P R E F T G**. Use the shortcuts, not the menu, on camera.
- **Mask editing** — Brush, Erase, Scissors, Level Tracing, Margin, Smoothing,
  Islands, Logical operators, Grow from seeds, Fill between slices, Copy across
  slices, Hollow.
- **Report** — "Your scan looks mostly healthy · 16 organs healthy, 1 finding"
  → **Patient/Doctor** selector → "FINDING 1 OF 1 — Pancreas" with a
  measurements panel.
- **3D pane**, **wall** (1,200 tiles, 0 broken, 0 API calls), **cards**,
  **compare** (`#17 vs #44`, 6 canvases).

---

## Broken — plan around these

1. **`NaN` on screen in the report.** The measurements panel reads
   `Mean HU · 47 · Report value: 47.2 +/- NaN`. The report text below it
   correctly says `47.2 +/- 38.5`. It is in the exact frame the 1:42 line points
   at. **Fix or frame out.** Highest priority.

2. **Hover-to-name does not exist.** No tooltip on 2D or 3D; zero tooltip
   elements. Naming lives in the organ list, whose entries read "Jump to aorta",
   "Jump to celiac artery". The 1:18 line must change.

3. **Share gives no visible confirmation.** No toast, URL unchanged. Nothing to
   film for 2:04.

4. **Reading session never started** — no recording state. Probably waiting on
   Chrome's native mic permission dialog. Grant it once manually.

5. **Inference run untested.** Never executed. If it fails the upload block drops
   and the cut shortens by ~12s.

6. **The report walkthrough moves the crosshair** and drops overlays on the
   finding step — coronal lands on femur at `321/344`. Re-centre between takes.

---

## Keep off camera

- **"32,768 CASES MATCH"** on `/dashboard`. The API reports `total = 32768` —
  exactly 2¹⁵, a search index cap. The VO says 36,390 eight seconds earlier.
- **Organ-stats rows**: `pancreas_body` `mean_hu -804.4` with **volume 184.1 cc
  against a whole pancreas of 31.02 cc** (a sub-part six times its parent),
  and `common_bile_duct` `mean_hu -715.6`. Both labelled "normal".
  `lung_right` at `-802` is legitimate — lungs are air.
- **The URL bar on localhost** — the share link copies `window.location.origin`.
  Shooting the product blocks on production avoids this entirely.

---

## Script

Full 2:56 script with per-beat action lives in **`launch-video-vo.md`** on this
branch. 187 words, ~145 wpm.

**Three corrections not yet applied to that file:**

- Restore **"or vessels"** at 0:56 — Angio is the vessel preset. An earlier edit
  wrongly changed it to "or lung".
- Rewrite 1:18 — hover-to-name doesn't exist. Suggested:
  *"Every structure is named — and one click takes you there."*
- 2:04 share — no toast exists; shorten to the menu click or cut the beat.

---

## Recording order

**Audio first, separately. Never at the same time as picture.**

1. Sign in; test inference once without recording; pre-warm all tabs (~20s each);
   mic test; DND; clean profile at 1920×1080; Screen Studio auto-zoom **off**
   for `cinematic`/`wall`/`cards`, **on** for product blocks.
2. **Record the VO** straight through, 2–3 takes.
3. **Capture routes** — cold open → wall → cards. Do these early: they run off
   local disk, so they survive the tunnel dropping.
4. **Product blocks** — viewer core (one continuous session, don't reload) →
   report → compare → share → reading session → upload last, since it's the
   least certain.

Roll 2–3 seconds before and after every beat. Reset between takes rather than
salvaging.

---

## Optional but recommended

Consider shooting the **product blocks on production** (`bodymaps.wse.jhu.edu`)
rather than localhost: it's signed in, rebranded, has real data, and shows a
**real URL**, which fixes the share beat. The capture routes only exist on the
demo branch, so those stay on localhost. Both origins now look identical.
