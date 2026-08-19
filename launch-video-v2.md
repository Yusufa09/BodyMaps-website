# BodyMaps — "One Scan" v2 · advertisement cut

Rewrite after professor feedback: *"Make it less like an education/instruction
video, but an advertisement video. The value is not to teach them how to use, but
to convince them this is useful."*

Reference: the ChatGPT Health ad (51s, youtube `lR58Dge8jE8`). Structure copied
deliberately. `launch-video-vo.md` is the previous cut — superseded, but keep it;
its shot URLs and hazard notes are still accurate.

**Runtime: 3:02.**

---

## 1. What was wrong, in one line

Nearly every VO line was an instruction to the viewer — a verb they were meant to
perform plus the name of the control that performs it. That is a manual read
aloud over a screen recording.

| v1 | v2 |
|---|---|
| "Adjust the window to bring out soft tissue, bone, or lung." | "Soft tissue. Bone. Vessels." |
| "Lets start by uploading a scan of our own. Drop in a file, choose a model, and go." | "Upload a scan. It comes back labeled." |
| "Want to see Two scans side by side? use the compare feature to Scroll them as one." | "Two scans. One scroll." |
| "And where the model got it wrong, the masks are yours to edit." | *(cut — advertises the failure case)* |

---

## 2. What the reference actually does

Measured off the file, not recalled:

- **51 seconds. No voiceover at all** — every word is on-screen type. Confirmed
  by decoding the audio: no speech-like dynamics anywhere.
- **The audio is one music bed with a strong pulse — no sound effects.** 52
  discrete transients, but their spacing repeats a fixed pattern
  (1.05 / 1.05 / 0.90 / 0.65 / 0.55s, median gap 0.95s), which is percussion on a
  loop, not per-element SFX. The snap comes from cutting the reveals to the beat.
- **Three headlines**, each alone on white ~2s, each followed by ~10s of evidence.
  A headline never shares the frame with UI.
- **No screen recordings.** Every product shot is a single card cropped out of the
  app and floated large on white. No browser chrome, no window frame.
- **No cursor. Not once.**
- **Type animates by typing on mid-word** ("the whole pr" → "the whole pregnancy?!").
- **Ends on the payoff line, then the logo held ~3.5s.** No recap, no stats.

Three rules carried into every beat below: **crop to one panel · no cursor ·
headline never shares the frame with UI.**

---

## 3. Two structural problems in the draft

### 3a. The stats fired twice — **FIXED**

Opening with "36,390 scans · 145 medical centers · nearly a million labeled
structures" is right: it's the claim, stated up front. But both ending surfaces
then counted the same figures back up, which spends the payoff twice.

**Applied:** the figures are gone from both endings.

- `cards.html` card 11 — the `.closing-stats` line is removed. The closing card is
  now wordmark + URL only.
- `WallPage.tsx` — the `wall-outro__stats` element is removed. The wall's own
  slate is now wordmark + URL only.

The figures are claimed once, at 0:10, and the wall at 2:38 is their **proof**.
Proof is stronger than repetition, which is what makes the ending land rather
than restate.

### 3b. The dashboard counter — dismissed

`/dashboard` shows "32,768 CASES MATCH", a 2¹⁵ search-index cap, ~20s after the
36,390 claim. **Called as not an issue and left alone by decision.** Noted here
only so it isn't re-raised.

---

## 4. The cut — 3:02

`[TYPE]` = a full-frame cut to a `cards.html` card.
`[OVER]` = a card captured at `?overlay=1` and Screen-blended over the footage
beneath it — see §4a.
`[CROP]` = existing footage cropped to the single panel named, floated large, no
browser chrome, **no cursor**.

Card numbers are the keys in §6.

### 4a. Overlays — three of them, and how they're made

Three beats put type over live picture: the figures over the rotating assembly
(0:10), the micro-type line over the viewer (1:21), and the closing slate over
the liver (3:01). All three sit on dark ground, so light type holds.

**Recipe, in CapCut:**

1. Capture the card from `/cards.html?overlay=1` — this grounds it on true
   `#000` instead of `--ink`, and drops the micro-type card to a lower third.
2. Lay the card on the track **above** the footage.
3. Select it → **Blend** → **Screen**.

Black drops to nothing; only the type survives. `--ink` is `#0F172A` — navy, not
black — so a card captured in the default cut mode would lift the whole picture
by that much. Overlay mode exists for exactly this reason.

**Screen can only lighten, so no scrim is possible behind overlaid type.** That's
why "That was one scan." (card 10) stays a **full-frame cut**: it would sit over
case 17's tile filling the frame, and CT tiles have bright regions with no way to
darken behind the words.

**Card 11 vs. the wall's own slate.** Both are now wordmark + URL only (§3a), so
they say the same thing — the difference is only where it lands. The wall's is
composited in code behind a real scrim, but sits over the grid; card 11 sits over
the returning liver. The cut below uses card 11 and passes **`outro=0`** to
suppress the wall's. Use one or the other, never both.

### Opening — 0:00–0:22

| t | Dur | On screen |
|---|---|---|
| 0:00 | 10s | Liver alone on ink, rotating. Structures step in around it, one every 160ms, building outward. `/cinematic/17?local=1&start=liver&hold=1800&step=320&speed=2.0` |
| 0:10 | 8s | Assembly holds, slow rotate. `[OVER]` card 1 — three figures count up over it, ~350ms apart |
| 0:18 | 4s | `[TYPE]` card 2 — **"Introducing / BodyMaps"**. Fades in, does not type. |

### The library — 0:22–0:33

| t | Dur | On screen |
|---|---|---|
| 0:22 | 3s | `[TYPE]` **"Browse the dataset."** |
| 0:25 | 8s | `[CROP]` `/dashboard` thumbnail grid scrolling. **Counter cropped out — see §3b.** Grid only, edge to edge. |

### Upload — 0:33–1:00

| t | Dur | On screen |
|---|---|---|
| 0:33 | 4s | `[TYPE]` **"Upload a scan. It comes back labeled."** |
| 0:37 | 6s | `[CROP]` `~/Desktop/test-scan.nii.gz` dragged onto the drop zone, file lands |
| 0:43 | 3s | `[TYPE]` **"Clinical-grade models."** |
| 0:46 | 7s | `[CROP]` model dropdown opens, options visible, one selected |
| 0:53 | 7s | `[CROP]` run starts, speed-ramped → **the labeled result appears** |

⚠ **The last shot is the whole claim.** "It comes back labeled" needs the labeled
output on screen or the beat promises something it doesn't show. Inference has
**never been executed** (VIDEO-PROJECT §9.5). Test it before you build around it.
If it fails, the honest fallback is to cut the claim to **"Upload your own."** and
end the block at the model picker — do **not** cut to case 17 and imply it's the
file you just uploaded.

### The viewer — 1:00–1:33

| t | Dur | On screen |
|---|---|---|
| 1:00 | 9s | `[CROP]` `/case/17?hd=1` opens, three MPR panes populate, organ cascade plays out |
| 1:09 | 3s | `[TYPE]` card 6 — **"Three planes. Three dimensions."** |
| 1:12 | 9s | `[CROP]` crosshair travels — all three panes track it, 3D pane orients with them |
| 1:21 | 3s | `[OVER]` card 7, lower third over the viewer: **"32 structures, labeled."** |
| 1:24 | 9s | `[CROP]` Meshes→Volume toggle, then MIP. Full-bleed, no type. **Not yet shot**; ~18s to render. |

### Measurement — 1:33–1:52

| t | Dur | On screen |
|---|---|---|
| 1:33 | 6s | `[CROP]` distance line drawn, mm readout settles. Crop to the readout. |
| 1:39 | 6s | `[CROP]` ROI drawn, HU and area resolve |
| 1:45 | 7s | `[CROP]` organ list — one entry selected, MPR re-centres in all three panes |

### The report — 1:52–2:14

| t | Dur | On screen |
|---|---|---|
| 1:52 | 3s | `[TYPE]` card 8 — **"Every case comes with a report."** |
| 1:55 | 9s | `[CROP]` report timeline animates node by node; the pancreas row flags amber |
| 2:04 | 10s | `[CROP]` finding selected — highlights on the scan. **Frame out the measurements panel** (`NaN`, §5). |

### Compare — 2:14–2:29

| t | Dur | On screen |
|---|---|---|
| 2:14 | 3s | `[TYPE]` card 9 — **"Two scans. One scroll."** |
| 2:17 | 12s | `[CROP]` `/compare-viewer?a=17&b=44`, linked slice position, both cases moving together |

### Ending — 2:29–3:02

| t | Dur | On screen |
|---|---|---|
| 2:29 | 3s | `[TYPE]` card 10, **full-frame cut**: **"That was one scan."** No scrim is possible over a bright tile — §4a. |
| 2:32 | 3s | Case 17's own tile fills the frame. |
| 2:35 | 9s | Pull-back begins, the grid resolves around it. `/wall?hero=17&cols=41&local=1&hold=3000&outro=0` |
| 2:44 | 8s | Scroll accelerates down through the tiles. **No type. No numbers.** (§3a) |
| 2:52 | 4s | Scroll runs out, grid comes to rest. Music sustains. |
| 2:56 | 1s | Hard cut to black. **Actual silence.** |
| 2:57 | 4s | The single liver returns, rotating on ink. `/cinematic/17?local=1&start=liver&hold=60000&speed=0.5` |
| 3:01 | — | `[OVER]` card 11 over the liver — wordmark, URL. Fades in. End on the held frame. |

---

## 5. Constraints carried forward

- **`NaN` in the report measurements panel** — `47.2 +/- NaN`. Sits in the 2:05
  frame. Cropping is the default treatment now, which solves it for free — but
  check the crop actually excludes it.
- **"32,768 CASES MATCH"** — see §3b. Highest-priority framing constraint.
- **Organ-stats artifact rows** — `pancreas_body` at 184.1 cc against a whole
  pancreas of 31.02 cc; `common_bile_duct` at −715.6 HU. Both labelled "normal".
  Keep off camera.
- **URL bar on localhost** — cropping removes browser chrome, so this stops mattering.
- **Hover-to-name does not exist.** Nothing in v2 claims it.
- **`?hd=1` on every viewer URL**, or the app serves low-res while the tunnel is up.
- **Organs load unchecked** — click "Toggle all" or the overlays and 3D pane are empty.
- **Never pre-warm the wall in a background tab** — rAF and `decode()` are
  suspended there; it sits frozen on the hero and looks broken.
- **Do not invent biography for case 17.** Verified: 52M, non-contrast CT
  colonography, impression "Enlarged pancreas.", pancreas status `check`. Nothing
  beyond that is yours to claim.

---

## 6. The type is built — `cards.html`

All 15 cards live in `PanTS-Demo/public/cards.html`, in film order, on `--ink`
ground with the brand tokens already wired. Verified working in-browser.

```
1 … 15   jump to a card by number — type both digits for 10 and up
→ ←      step through in film order
R        replay the current card
```

Digits 2–9 jump instantly. Only `1` waits ~350ms, because it might still become
10–15; the buffer shows nothing until it settles, so typing `12` never flashes
card 1 on the way.

Copy lives in a `data-type` attribute and reveals character by character — the
type-on the reference uses. Per-card speed override with `data-cps` (default 30
chars/sec; a headline lands in ~1.3s).

To change a line, edit the attribute — nothing else:

```html
<h1 class="headline" data-type="Two scans. One scroll."></h1>
```

The `::before` ghost holds the box at full size from frame one, so a headline
that wraps to two lines doesn't re-flow as characters arrive. Measured stable at
576×99 through a full run.

**Two capture modes.** Cards 1, 7 and 11 go over footage and must be captured in
overlay mode; the other eight are straight cuts.

```
/cards.html              cut mode      — grounds on --ink, cut straight in
/cards.html?overlay=1    overlay mode  — grounds on #000 for Screen-blending,
                                         micro-type drops to a lower third
```

**Capture:** fullscreen (Cmd-Ctrl-F), arm the recording, press `R`. Screen Studio
auto-zoom **off** for these. Keep the tab focused — `requestAnimationFrame` is
suspended in background tabs and the type-on will freeze, then jump.

Card order and timecodes:

| Key | Card | Reveal | Mode | t |
|---|---|---|---|---|
| 1 | stats count-up | count | **overlay** | 0:10 |
| 2 | "Introducing / BodyMaps" | **fade** | cut | 0:18 |
| 3 | "Browse the dataset." | type | cut | 0:22 |
| 4 | "Upload a scan. It comes back labeled." | type | cut | 0:33 |
| 5 | "Clinical-grade models." | type | cut | 0:43 |
| 6 | "Three planes. Three dimensions." | type | cut | 1:09 |
| 7 | "32 structures, labeled." | type | **overlay** | 1:21 |
| 8 | "Every case comes with a report." | type | cut | 1:52 |
| 9 | "Two scans. One scroll." | type | cut | 2:14 |
| 10 | "That was one scan." | type | cut | 2:29 |
| 11 | closing — wordmark, URL | **fade** | **overlay** | 3:01 |

**Monochrome — no accent colour.** The brand orange (`--accent-tint #F08A6F`) is
removed from both capture surfaces. Everything on camera is `--on-ink` `#F7F7F4`
or `--on-ink-muted` `#8A93A6` on the ink ground; hierarchy comes from size and
weight. Verified: two distinct colours across all 11 cards, no orange.

> This is a deliberate departure from `BRANDING.md`, which defines the orange
> accent system as the BodyMaps brand. Scoped to `cards.html` and `WallPage.tsx`
> only — the app is untouched, so the Brand guard workflow is unaffected.

**Cut for text density:** "Analyze it.", "Or rendered whole.",
"Distance · Area · Density in Hounsfield units" and "Anything worth measuring,
measured." are removed. Their footage stays — the viewer, the volume render and
the measurement sequence now play without a card introducing each one. 15 cards
→ 11, and the film from 3:15 to 3:02.

⚠ **Number check on card 1.** It counts `993K` structures and a fourth figure,
`32 classes per scan`. The script says "nearly a million" and lists three
figures. Pick one and make the card, the closing card, and the script agree — and
only use `993K` if you can source it.

---

## 7. No voiceover — decided

**The film carries no voiceover.** Every word is on-screen type, over a music bed.
This matches the reference exactly and removes the least reliable production
dependency — no mic, no takes, no pacing against picture.

The fallback read that used to live here is withdrawn. If a voice is ever added
back, the hard rules stand: no imperative verbs, no UI control names, no second
person.

## 8. What this costs

**Reuse, re-cut only:** dataset grid, upload drag, viewer core, crosshair,
measurement, organ list, report, compare. Cropped and shortened, not replaced.

**Shoot new:**
- Model dropdown open + selection (a beat, not a whole block)
- The inference run through to a labeled result — **untested, test first**
- Wall (route rewritten since the last capture)
- Volume rendering (~9s, never shot)
- The 12 type cards — `cards.html`, done and verified (§6)

**Build new:** nothing. The type is built — 12 cards.

**Dropped from v1:** VO recording, reading session, share beat, mask editing,
clinical⇄plain-English toggle, windowing presets.

---

## 9. One thing worth reconsidering

You cut the **clinical ⇄ plain English** toggle. It was the beat that most
directly answered "why is this useful" rather than "what does this do" — the
impression rewriting itself in place is a value claim, not a feature. If anything
needs to come out later for time, the compare block at 2:18 is twelve seconds of
two scans scrolling and would survive being eight.
