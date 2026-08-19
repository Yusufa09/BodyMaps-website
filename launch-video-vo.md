# BodyMaps — "One Scan" · VO + shooting script

> # ⚠ SUPERSEDED — DO NOT SHOOT FROM THIS FILE
>
> **The live script is [`launch-video-v2.md`](launch-video-v2.md) — 3:02, no voiceover.**
>
> This is the v1 cut, kept for history only. It was rewritten after the professor
> asked for an advertisement rather than an instruction video. Almost every
> specific below is now wrong:
>
> | This file says | Now |
> |---|---|
> | 2:56, 207 words of VO at 49% speech density | **3:02, no voiceover at all** — every word is on-screen type |
> | Reading session at 2:08 | **Cut** — never started; no recording state |
> | Share beat at 2:04 | **Cut** — the app gives no visible confirmation |
> | Mask editing at 1:24 | **Cut** — it advertised the model getting things wrong |
> | Windowing presets at 0:56 ("or lung") | **Cut** — moot; Angio is the vessel preset |
> | `/wall?hero=17&n=1200&cols=20&local=1` | `/wall?hero=17&cols=41&local=1&hold=3000&outro=0` |
> | 3 cards in `cards.html` | **11 cards**, two capture modes |
> | Figures repeated at the ending | **Removed** — stated once at 0:10, the wall is the proof |
> | Orange accent, "Johns Hopkins University" | **Both removed** from every capture surface |
> | Full-window screen recordings with a cursor | Cropped to one panel, **no cursor** |
>
> **Still accurate here:** the `?hd=1` rule, the cold-open URL, and the
> "Keep off camera" notes on `pancreas_body` / `common_bile_duct`. Everything
> else lives in `launch-video-v2.md` and `SHOOT-CHECKLIST.md`.


**Cut:** 2:56 · **Words:** 207 · **Pace:** ~145 wpm (`words ÷ 2.4 ≈ seconds`)
**Speech density:** 86s of voice across 176s — 49%. Still under half, but the
silence has less room than it did.

Every viewer URL takes `?hd=1`. Without it the app serves `?res=low` whenever the
JHU server is reachable, so having the tunnel up makes the picture *worse* unless
you ask for full res.

**SRV** marks a block that needs the tunnel.

---

## Shooting script

| Time | On screen | VO |
|---|---|---|
| 0:00 | `/cinematic/17?local=1&start=liver&hold=1800&step=320&speed=2.0` — press **R** to arm. The liver alone on ink, rotating. Holds 1.8s. | *(silence)* |
| 0:04 | Structures step in, one every 160ms, building outward. 23 in total; the lungs are excluded — truncated by the top of the volume, they read as broken geometry. | **One abdominal CT is over a thousand images. Somewhere inside them is everything you need to know.** |
| 0:09 | Assembly settles. Cut to `/cards.html` card **1** — the mark resolves out of blur. | *(silence — let the title land)* |
| 0:12 | `/cards.html` press **2**. Four figures count up, ~350ms apart, in accent orange. | **Thirty-six thousand, three hundred ninety scans. A hundred and forty-five medical centers. Nearly a million labeled structures. Introducing BodyMaps.** |
| 0:20 | Cut to the library grid. Scroll it briefly, then move to Upload. | **You can either select a scan from our downloaded datasets, or upload a ct scan.** |
| 0:26 | **SRV** `/upload` — drag `~/Desktop/test-scan.nii.gz` onto the drop zone. Model picker appears. Start the run; speed-ramp the pipeline. | **Lets start by uploading a scan of our own. Drop in a file, choose a model, and go.** |
| 0:38 | `/case/17?hd=1`, already warm. Three MPR panes, soft-tissue window. | **Now lets analyze this scan Thirty-two structures, labeled.** |
| 0:46 | Organ cascade plays out. Then drag the crosshair — all three panes track it, and the 3D pane orients with them. | **In three planes. Axial, coronal, sagittal. And in three dimensions.** |
| 0:56 | Window/level: Soft Tissue → Bone → Lung. Tissue drops away, skeleton resolves, then air. | **Adjust the window to bring out soft tissue, bone, or lung.** |
| 1:04 | Scrub the slice slider through the stack — one continuous pass, no stutter. | **and scroll through the whole volume.** |
| 1:10 | Draw a distance line, then an area. Let the HU readout settle. | **Measure anything. Distance, area, density in Hounsfield units.** |
| 1:18 | The docked organ list, every structure named. Click the target icon beside two or three — aorta, then pancreas — and the MPR re-centres on each in all three panes. | **Every structure is named — and one click takes you there.** |
| 1:24 | Open the docked Segments panel. Brush a mask edge, smooth it, split a class. | **And where the model got it wrong, the masks are yours to edit.** |
| 1:34 | **SRV** Report opens. Timeline animates node by node; the pancreas row flags amber (`status: "check"`). | **Every case comes with its own report.** |
| 1:42 | **SRV** Select the pancreas finding — it highlights on the scan and in 3D. | **Select a report finding and it highlights on the scan.** |
| 1:49 | **SRV** Toggle clinical → plain language. The impression rewrites in place. | **In clinical language. Or in plain English.** |
| 1:56 | `/compare-viewer?a=17&b=44`, pre-warmed. Enable linked slice position and scroll — both cases move together. | **Want to see Two scans side by side? use the compare feature to Scroll them as one.** |
| 2:08 | **SRV** Reading session: dictate a line, the draft assembles beneath it, export the bundle. | **Dictate as you read. The session assembles a draft report, and exports as a single bundle.** |
| 2:20 | `/wall?hero=17&n=1200&cols=20&local=1` — press **R**. Case 17's own tile fills the frame. | **That was one scan.** |
| 2:24 | Pull-back begins. The grid resolves around it. | *(beat)* |
| 2:30 | Scroll accelerates down through 1,200 tiles. | **BodyMaps has thirty-six thousand, three hundred and ninety.** |
| 2:34 | ~12s of music only. Scroll runs out, the tumour filter re-flows the grid, type resolves. | *(silence)* |
| 2:46 | `/cards.html` press **3**. Figures, then the mark, then the URL, then the institution. | *(silence)* |
| 2:56 | End. | |

---

## Continuous read

Record straight through with a beat of silence between paragraphs.

> One abdominal CT is over a thousand images. Somewhere inside them is everything you need to know.
>
> Thirty-six thousand, three hundred ninety scans. A hundred and forty-five medical centers. Nearly a million labeled structures. Introducing BodyMaps.
>
> You can either select a scan from our downloaded datasets, or upload a ct scan.
>
> Lets start by uploading a scan of our own. Drop in a file, choose a model, and go.
>
> Now lets analyze this scan Thirty-two structures, labeled.
>
> In three planes. Axial, coronal, sagittal. And in three dimensions.
>
> Adjust the window to bring out soft tissue, bone, or lung.
>
> and scroll through the whole volume.
>
> Measure anything. Distance, area, density in Hounsfield units.
>
> Every structure is named — and one click takes you there.
>
> And where the model got it wrong, the masks are yours to edit.
>
> Every case comes with its own report. Select a report finding and it highlights on the scan.
>
> In clinical language. Or in plain English.
>
> Want to see Two scans side by side? use the compare feature to Scroll them as one.
>
> Dictate as you read. The session assembles a draft report, and exports as a single bundle.
>
> That was one scan.
>
> BodyMaps has thirty-six thousand, three hundred and ninety.

---

## Where the extra time went

Your draft ended at 2:04. Three additions bring it to 2:56:

| Added | Time | Why |
|---|---|---|
| Library reveal | 26s | Restores the payoff the cold open sets up. The hero tile is now correctly centred at index 610. |
| Reading session | 12s | 2:08–2:20. Dictate → draft → bundle. Verified working against the server. |
| "Select a scan… or upload" + the organ list | 12s | Your line bridges stats → upload, and gives the library a reason to be on screen before the reveal. The organ-list beat replaces hover-to-name, which the UI does not have. |

The share beat at 2:04 has since been cut. Runtime is unchanged at 2:56 — the 4s
went to compare, which now runs 1:56–2:08 on a single linked scroll.

---

## Corrections made to the draft, and why

- **"thousands of images" → "over a thousand images."** Case 17 is `shape [484,344,219]`: 219 axial slices, 1,047 across all three planes. "Thousands" overstated by 3–5× in the film's first factual claim; "over a thousand" is exact — 1,047 clears it by 47.
- **"or vessels" → "or lung."** The viewer's window presets are Soft Tissue, Bone, Lung. There is no vessel preset — you'd have said a word the UI contradicts.
- **"Every organ, every difference" → "…use the compare feature to Scroll them as one."** Compare has no volume-delta readout; every "volume" in `CompareViewerPage` is Cornerstone's pixel array. The original line promised computed differences that don't exist. The current phrasing keeps that constraint.
- **"Tap a finding" → "Select a report finding."** Desktop app, cursor, not touch. "Report" added to separate findings from measurements, which are also selectable on the same screen.
- **"our many AI models" → "a model."** Four lesion models are visible on the upload page (pancreatic, liver, kidney, colon); the handoff claims six total. "Many" was vague and I could not verify a number — confirm on screen if you want to name one.
- Dropped the filler: "Like", "as well", the doubled period.
- **Share beat cut.** The 2:04 copy-link line ("Any view you build is a link") is
  gone. It was the one beat with nothing filmable behind it — no toast, URL
  unchanged — and on localhost the link copies `localhost:5173`. Cutting it
  removes that problem rather than working around it.

## Keep off camera

In the organ-stats table, two rows are segmentation artifacts labelled "normal":

- `pancreas_body` — `mean_hu -804.4`, **volume 184.1 cc against the whole pancreas at 31.02 cc.** A sub-part six times its parent is the visible tell, more than the HU.
- `common_bile_duct` — `mean_hu -715.6`, also air density.

`lung_right` at `-802` is legitimate; lungs are air.

## On "Thirty-two structures"

32 is the model's class count, not what case 17 contains — it has 25 meshes, and the
cold open shows 23 after the lungs are excluded. It is fair as a capability claim.

The 0:38 line used to carry "Every organ, vessel and bone" behind the number, which
gave a viewer something concrete to check it against. With that clause cut, the
number stands alone over a 3D pane holding 25 objects, and the gap is more exposed
than before. Either restore the clause or drop the number — "Now let's analyze this
scan. Every organ, vessel and bone, labeled." reads clean and claims nothing the
screen contradicts.
