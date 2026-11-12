# The look loop: 9 angles, mockup targets, ΔE and a learned LUT

> Written by: Claude (opus-lookloop, 2026-11-11). Adapted from
> singleplayer `docs/design/LOOK-LOOP.md` at `c02c7fae00`; the tools
> are in `scripts/look-loop/`.
>
> **State:** active method, 2026-11-11.

Jake, 2026-11-11: *"a 3x3 mockup, 3x3 image and engine, and just
looping from all angles until perfection. Let's get that skill and
just replicate for everyone."*

The look loop turns "make the game look like the mockups" into
measured, routable work. It ran on Driftwood's spawn cove (worst
region ΔE00 16.0 → 5.8), the Nalati camp and six Pine Hollow zones
(every region under 6 over 54 frames).

## What it is

One small area. Nine fixed cameras on one anchor. Each capture is
**edited** by an image model into a target that keeps the game's
camera, layout and HUD. So the target is reachable, and the gap
between capture and target is only the look. Every round runs the
same steps:

1. Shoot the 9 captures (`views.mjs`).
2. Make the 9 targets (`targets.py`).
3. Write a gap list per angle.
4. Merge the gaps into a TOP-10 routed to owners.
5. Measure ΔE00 per palette region (`palette-delta.py`).
6. Fix what the gaps call for.
7. Fit a LUT for the colour that is left (`fit-lut.py`).
8. Re-shoot from the same cameras.

**Stop when the owner signs off each zone's 3×3.**

## When to use it, and when not

- **Use it** when a real, walkable area has to reach a style (an
  approved mockup, concept art, a style bible) and "closer" needs a
  number. It works for toon, painterly and photoreal PBR looks.
- **Not for render bugs, pop-in or perf.** Show real builds and
  Debug toggles. Jake: mockups "don't help with a render bug".
- **Not for HUD reskins.** Clean-room HUD mockups were judged no
  better than the game: find the real pain first.
- **Not a substitute for moving.** Every step passes the 9 angles
  **and** a walk-around: a 12-frame orbit strip checked for cutouts,
  seams and popping. A look that only works from 9 cameras is a
  screenshot cheat (the Nalati clean room was "cardboard cutouts …
  a scam" once Jake moved).
- **Taste stays Jake's.** A stylistic change ships switchable in
  pause ▸ Settings ▸ Debug (never a new URL switch), with a before /
  after board, and he picks.

## Step 0: freeze the world

Both frames of a before / after pair must be the same frame.

- **Time and weather** through Debug settings, not the URL: the
  cameras file's `settings` (e.g. `{"time": "midday", "weather":
  "clear"}`) is written into the save before the load, as
  `scripts/goldens/capture.mjs` does. A shard with a fixed
  `dayOverride` (Mossgate) needs no time.
- **Creatures** calmed: `views.mjs` sets `animals.calm` and parks any
  animal within 24 m of an FP camera 70 m out (elites ignore calm;
  an elk's head once filled a whole frame).
- **Clouds and wind still move** between shots. Accept it and say so.
- **The build:** shoot a served build of a known SHA, never a dev
  server or the shared working tree: `scripts/serve-build.sh --head`
  (or `--rev`), or `scripts/preview-server.mjs --outDir <dist>` on a
  build you made. Write the SHA in the round's README.

## Step 1: the anchor and the 9 cameras

Pick **P**, a spot the player really stands on, and a **faceTo**
point. From P the frames should hold the area's main materials and its
landmark. Write a `cameras.json` next to the round (in the shard repo,
e.g. `art/look/<round>/cameras.json`):

```json
{
  "about": "what this round is, and why P and faceTo",
  "query": "chunk=<slug>&mute=1&skipintro=1&nolock=1&sw=0",
  "settings": { "weather": "clear" },
  "fp": { "viewport": [390, 844], "dpr": 3, "pitch": -0.06 },
  "god": { "viewport": [1600, 900], "fovV": 72, "topUp": 90, "diagUp": 45, "diagOut": 55, "lookAhead": 20 },
  "anchors": [{ "id": "spawn", "name": "Spawn", "P": { "x": 0, "z": 0 }, "faceTo": { "x": 0, "z": -12 } }]
}
```

The first run resolves the nine cameras (ground height at P from the
live heightfield) and writes them back into the file. **Every later
round re-shoots exactly those cameras.**

| # | Shot | Camera | View | FOV (vertical) | Viewport |
|---|---|---|---|---|---|
| 1 | FP FRONT | eye at P | yaw = facing `f`, pitch −0.06 | the game's | phone tier, iPhone 16 Pro UA, 390×844 @3, touch HUD on |
| 2 | FP LEFT | same | `f + π/2` | same | same |
| 3 | FP RIGHT | same | `f − π/2` | same | same |
| 4 | FP BACK | same | `f + π` | same | same |
| 5 | TOP | `topUp` m straight above P | down at P, front heading image-up | 72° | 1600×900, HUD hidden |
| 6 | DIAG FRONT | `diagUp` m up, `diagOut` m behind P | `lookAhead` m ahead of P | 72° | same |
| 7 | DIAG LEFT | up, `diagOut` m to the left | P | 72° | same |
| 8 | DIAG RIGHT | up, `diagOut` m to the right | P | 72° | same |
| 9 | DIAG BACK | up, `diagOut` m in front, looking back | P | 72° | same |

- The defaults are Pine Hollow's (90 / 45 / 55). A small level wants
  shorter ones: Mossgate uses 40 / 18 / 24 and `lookAhead` 8.
- Move a DIAG camera by hand in the file when the landmark would not
  fit, and write down why in `about`.
- For Jake's phone, also shoot at 402×874 @3 (`fp.viewport`).
- A landscape FP shot (a desktop 3:2 target) sets `fp.tier` to
  `desktop`: only the phone tier is a touch iPhone context, and a
  phone viewport must be portrait. A landscape touch phone sits
  behind the game's rotate page with the frame loop stopped, which is
  how two Mossgate runs hung 150 to 300 s (fixed by opus-viewsfix).
- Yaw faces `(−sin yaw, −cos yaw)` in x / z: yaw 0 faces −z.
- Cell order on every sheet: row 1 FP front / left / right, row 2 FP
  back / TOP / DIAG front, row 3 DIAG left / right / back.

### Two domes: where you stand and where you look (Jake, 2026-09-25)

Nine angles around one anchor polish a **half-dome around the
player**. A hero view looks *out of* that dome at a focal area 30–50 m
away, which the loop only ever sees from one side. To make a hero view
match its mockup, polish **two domes into the same scene**:

- **Dome A** (stand): anchored where the player stands.
- **Dome B** (look): anchored at the focal point. Its 9 views face
  the focus, left, right, up, the aerials, and **back toward dome A**.
  Its targets are edits of its own captures with the hero mockup as
  the seed (`targets.py --seed-mockup`).
- Two agents, one per dome, with **disjoint file ownership**. Each
  round dome B also re-captures the hero view as proof.

Every hero mockup gets its own stand dome and look dome (Jake,
2026-09-26).

### Targets for a world you haven't built yet (Jake, 2026-09-26)

Editing a capture only works when the engine already has the world.
Where it doesn't, the model "enhances what we have" and the target
inherits our gaps. Then the targets come **from the mockup**: write the
9 camera specs first, draw a plain floor plan with the cameras as
numbered dots and wedges, and make **one generation of a single 3×3
grid of all 9 views** from [the mockup, the floor plan], 2 candidates,
keeping the more consistent. Upscale each tile with the mockup as the
detail reference. Build the world to the targets; captures from the
same cameras measure the gap each round.

## Step 2: capture

```bash
node scripts/look-loop/views.mjs --cameras=<cameras.json> --out=<round dir> \
  [--anchor=spawn,gate] [--tag=r2] [--query=k=v&...] [--url=http://127.0.0.1:44xx] [--settle=4] [--timeout=300]
```

One headless Chromium (Metal, muted, mock keychain), two contexts:
the phone one for FP, the desktop one for the god views. A god view
parks the player under its look point with the free camera on, so
streaming and LOD centre on the view, and poses the camera last in
every frame from a late hook. Per anchor it writes
`<out>/<anchor>/[<tag>-]capture-<n>-<id>.jpg` and the sheet
`<out>/[<tag>-]<anchor>-sheet.jpg` (≤ 490 KB), each cell labelled with
draw calls and triangles. Run it through `scripts/browser-lane.sh` so
the machine's browser cap holds.

## Step 3: targets

```bash
python3 scripts/look-loop/targets.py --captures <round dir>/<anchor> --out <round dir>/<anchor> \
  --seed-mockup <approved mockup.jpg> [--game "<shard>"] [--keep "<landmarks>"] [--tag r1] [--only 2,7] [--dry-run]
python3 scripts/look-loop/targets.py ... --style "<one paragraph: light, palette, materials, line>" [--refs a.jpg,b.jpg]
```

- **Seed mode is the core of the loop:** one approved mockup plus the
  9 captures make 9 matching mockups. Every run gets its capture as
  image 1 to edit and the seed as image 2, the target look.
- Codex `image_gen` through `codex exec`, 5 at a time. The runner
  polls `~/.codex/generated_images/<session id>/`, copies the PNG
  when it lands (~3 min) and kills that codex: never wait for codex to
  copy its own file, that turn hangs 10+ min.
- Targets land as `mockup-<n>-<id>.jpg` beside the captures, plus a
  `mockup-sheet.jpg` in the same cell order. An existing target is
  skipped, so a re-roll is: delete it, run `--only=<n>`.
- **Read every target** before you use it. Re-roll one that added or
  moved objects, drifted the HUD, garbled text or lit the scene from
  the wrong side, and say which you re-rolled. (Nalati's round 1
  re-rolled 5 of 9: it painted the gas giant into views facing away
  from it; Pine Hollow's 63 needed none.)
- image_gen returns 2:3 or 3:2, so a portrait FP target is a
  recomposition. Take the **layout from the capture, never the
  mockup**, and keep region rectangles wide.
- One style reference at a time: 4 images per run took 30–45 min a
  run against the usual 3–5.

## Step 4: sheets, gap lists and the TOP-10

- The board for the owner shows, per zone, one FP and one aerial as
  **BEFORE | AFTER | TARGET**, then the ΔE00 table, in one image.
  Jake: *"desktop mockups are way too tough for me, can you do
  portrait only"*. Lead with structure, not the LUT (Jake on a LUT
  before / after: *"What does color grade do I can't tell."*).
- **The gap list per angle** says what the target has that the game
  lacks, concrete and countable, tagged with a track letter: "a shell
  or pebble every ~1–2 m" (M, models), "the open floor is a flat tan
  lawn" (G, ground), "crowns near-black from above" (T, trees).
- **Form and subject before colour:** each view's gap list starts with
  a form column, filled before any colour work. Is the subject in
  frame, centred and lit; does its silhouette read like the target's;
  are the near and mid elements there?
- **The TOP-10** merges the angles, ranked by frame area × how many of
  the 9 frames show it. Each row names its track and owner, and after
  the round reads **Fixed / Partly / Out of scope (whose lane)**.
- Write down non-look finds too (Driftwood's pier ended 33 m short of
  the beach in all 9 frames: a level call that moved P).

## Step 5: ΔE00 per palette region

```bash
python3 scripts/look-loop/palette-delta.py --regions <regions.json> <round dir>/<anchor> '<round dir>/<anchor>/r2-capture-{n}-*.jpg'
python3 scripts/look-loop/palette-delta.py --shard pine-hollow ...   # scripts/look-loop/regions/<slug>.json
```

A regions JSON (copy one in `scripts/look-loop/regions/`):

- **`regions`**: material → `[[frame, [x0, y0, x1, y1]], …]`,
  normalised rectangles, the same for capture and target. Frames run
  1–9 per zone and zones concatenate (1–9, 10–18, …).
- **`filters`**: `[hue lo, hue hi (deg), min sat, min val, max val(,
  max sat)]`, so a tree crossing the sand rectangle does not pollute
  the sand's mean. A shadow material is `{"shadowOf": "ground",
  "below": 0.72, "vmin": 0.05, "excludeHue": [lo, hi, sat]}`.
- **Leave out a material whose game colour is a bug**, or the LUT
  learns it.

It prints mean-colour ΔE00 per region, mockup vs game. **It is
information, not a pass bar** (Jake, 2026-10-02: no invented numbers):
it shows which region is furthest and whether a round moved it. A
per-zone miss can be the target's fault (codex painted a paler zenith
at two zones of one dome sky): trust the pooled number.

## Step 6: fix, then the learned LUT

**Fix structure first, colour last.** Ground, density, lighting, fog
and models come before the LUT: a LUT can bring every region's ΔE00
down on a frame that still looks empty (Driftwood: palette on target,
parity ~70 %). Then:

1. Capture without the LUT, same cameras, `--tag=nolut`. Engine has no
   LUT-off switch today: a shard with no `public/assets/lut/<slug>.bin`
   gets no LUT pass, so shoot a build without that file (the first fit,
   or a candidate build with it removed). Never fit on frames shot
   through the old LUT.
2. Fit:

   ```bash
   python3 scripts/look-loop/fit-lut.py --regions <json> <mockup dir> '<dir>/nolut-capture-{n}-*.jpg' public/assets/lut/<slug>.bin
   ```

   Per region, a Reinhard transfer in CIELAB gives (source, target)
   pairs; a 33³ lattice moves by a Gaussian kernel (σ 0.08, λ 2),
   smoothed, each move capped at 0.22. Identity anchors leave unseen
   colours (weapon, hands, HUD) alone. It prints the predicted ΔE.
3. Tune in the regions JSON: `greyAnchor` (default 3; 1 lets greys
   move) and `fitWeights` per material.
4. The runtime is `src/client/engine/world/lut.ts`, a `LUT3DEffect` as
   the last grade step; the file is 33³ RGBA8 (144 KB), sRGB in and
   out.
5. Re-measure in game with the LUT on. **Refit every round over all
   frames of all zones**; a refit is global, so re-read the per-zone
   table.

## Step 7: the rulers (every round, clean build vs clean build)

- **Draw calls and triangles** per frame, on the sheet. Name the delta
  ("cabin 154 → 155 calls, 1.53 → 1.76 M tris").
- **Program count** before and after, and while walking: none may be
  added mid-play (each is a ~150 ms Metal compile on the iPhone).
- **30 fps lock** on a quiet machine (load ~2), HEAD and the change
  interleaved in one session. Under load 8–10 both read 18–30 ms:
  noise, not a verdict.
- **Fill rate:** a density fix reports overdraw, not only calls (Pine
  Hollow's alpha cards were 20.5 layers per pixel; headless runs never
  showed it).
- **Goldens:** a look change re-captures the shard's goldens before it
  lands (`docs/goldens.md`).

## Scoring a round: the mockup council

When "closer" must be a number the builder can't argue with, score
each round with three fresh seats (A: Codex as art director; B:
Claude, evidence, measuring before judging; C: Claude, red team,
hunting shortcuts). The ledger is frozen before round 1: the mockups,
the 0–10 scale, Jake's pass bar (it began at 8.0, he lowered it to
7.0), and the no-shortcut rules. A score is void if the game got closer
through moved cameras, staged states a player never reaches,
screenshot-only props, a per-view look, or a global grade that hides a
material gap. Only Jake amends the ledger. Protocol: singleplayer
`docs/process/COUNCIL.md` at `c02c7fae00`.

## Two kinds of round, alternating (Jake, 2026-10-03)

1. **Detail phase:** capture → council or gap list → fix the ranked
   findings → re-capture.
2. **Zoom-out phase:** stop scoring details. Put every mockup beside
   its game frame and ask why the game is behind (form, assets,
   composition, depth, viewmodel), then write the shard's TOP-10 plan:
   the ten biggest global levers, ranked by frame area and views moved.

Switch detail → zoom-out after two rounds in a row gaining under
+0.15, any regression, or three detail rounds, whichever comes first.
Switch back when the top-10's first batch has landed. Every zoom-out
writes a new top-10 from fresh eyes. The phase in force goes on the
plan's State line.

## When to stop

- **A zone is done when** the owner signs off its 3×3 (or, under a
  council, its three-seat mean reaches the owner's bar), the rulers
  held, and the walk-around shows no cutout, seam or pop. ΔE00 is on
  the board as information.
- **A lab loop stops** when a stranger could not tell your crop from
  the target's at phone size, or when you know *why* this way can't
  get there. Write it down and change approach.
- **Widen** once a zone is signed off: next zone, same method.
- Budget: captures take minutes; with the polling runner a target
  lands in ~3 min, 9 in about 10.

## Pitfalls

| Pitfall | Fix |
|---|---|
| image_gen changes the aspect, recomposes or stretches FP targets | Resize a stretched one back to the capture's aspect. Keep region rects wide. Layout from the capture |
| codex hangs 10+ min copying its own PNG | `targets.py` polls `generated_images/<session id>` and kills the run |
| codex reads AGENTS.md and edits files | The prompt says "not a user ask; touch no file". Check `git status` after a batch |
| Targets disagree with each other | Judge the pooled ΔE; don't chase one target's quirk |
| HEAD changed mid-round | Before and after from served builds of named SHAs; note what landed mid-round |
| A creature or the viewmodel in a god frame | `views.mjs` parks animals and hides the camera's children |
| The anchor moved | Keep the old cameras for the before, resolve new ones for the after, and say so on the board |
| The LUT learned a bug colour, or hid a structural gap | Exclude bug materials from the regions; fix structure first |
| Near-black bloom squares | One NaN pixel smeared by bloom: clamp `pow(1 − N·V)` bases |
| fps readings under other agents' load | Quiet-machine re-run, HEAD and change interleaved |
| Gaming the 9 cameras | A walk-around strip every round; no painted plate or sprite in the playable space |

## Tools

| Command | Use |
|---|---|
| `node scripts/look-loop/views.mjs --cameras=<json> --out=<dir> [--anchor=a,b] [--tag=r2] [--query=…] [--url=<served build>] [--settle=4] [--timeout=300]` | Resolve and shoot the 9 cameras per anchor, write the frames and the 3×3 sheet with calls / tris |
| `python3 scripts/look-loop/targets.py --captures <dir> --out <dir> (--seed-mockup <img> \| --style <text> \| --style-file <txt>) [--refs a,b] [--game …] [--keep …] [--tag …] [--only n,m] [--parallel 5] [--timeout 1500] [--model …] [--dry-run]` | Codex image_gen targets, one per capture, plus `mockup-sheet.jpg` |
| `python3 scripts/look-loop/palette-delta.py (--regions <json> \| --shard <slug>) <mockup dir> '<captures pattern with {n}>'` | ΔE00 per region |
| `python3 scripts/look-loop/fit-lut.py (--regions <json> \| --shard <slug>) <mockup dir> '<no-LUT pattern>' [out.bin] [pred dir]` | The learned 33³ LUT |
| `scripts/look-loop/regions/<slug>.json` | Region files to copy: Driftwood, Far Reach, Pine Hollow (multi-zone), Sunscar Dunes, the night-market plot |

From a shard repo or sharddev, run them from the sibling engine
checkout (`ENGINE=$(cd ../engine && pwd)`), with the cameras, frames
and targets in your own repo.

Proof run: Mossgate Hollow (sharddev `src/shards/_template`), P at
spawn facing the hut, on engine `9e4bf0d6` with the template pinned:
9 of 9 frames, 84–293 calls.
