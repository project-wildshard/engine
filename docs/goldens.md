# Goldens: the known-good look, re-captured before a look change lands

> Written by: Claude (opus-k9, REPO-KIT K9, 2026-11-11). Carried from singleplayer's `docs/process/GOLDENS.md`.
> Skill: [.claude/skills/goldens/](../.claude/skills/goldens/SKILL.md).

Jake, 2026-11-03: *"The golden images are really fucking important.
Agents should be recapturing golden images and comparing them against
the known good golden images … the most basic thing you can do to check
it."* On 11-02 lanes landed Nine render perf cuts checked only with
pixel diffs; nobody re-ran the goldens, and Nine shipped with walls and
floors missing on the iPhone. Jake, 2026-11-11 (J273, K9): goldens go
into each major shard, and each shard runs its own goldens.

## Where every set lives

The harness is engine's; the reference frames are each shard repo's own
(sibling checkouts under `~/projects/games/wildshard/`).

| Thing | Path | What it is |
|---|---|---|
| SHARDFILE goldens | `<shard repo>/art/goldens/shardfile/<nn>-<camera>.jpg` | **The look to hold** (G859, G873 L5). 24 per shard, 22 px label strip on top. |
| LEGACY goldens | `<shard repo>/art/goldens/legacy/<nn>-<camera>.jpg` | The frozen record of LEGACY (10-28, G843). Never re-captured, never updated. |
| Cameras | `<shard repo>/art/goldens/cameras24.json` (engine copy: `scripts/perf/cameras24.json`) | 24 cameras: 1–4 CO6, POIs, coverage, 2 aerials, 2 hands. Eye, yaw, pitch, FOV, probe. |
| Update log | `<shard repo>/art/goldens/README.md` | Source run and every promotion, with its ruling. |
| Rerun boards | `<shard repo>/art/goldens/runs/<date>-<sha10>-board.jpg` | The ≤ 500 KB board a look change lands with. |
| Capture | `scripts/goldens/capture.mjs` (engine) | Chromium (or `--engine=webkit`), iPhone 16 Pro portrait, phone tier, 2×, seed 357, midday / clear, HUD hidden. |
| Board | `scripts/goldens/board.py` (engine) | LEGACY · SHARDFILE · NOW per camera, labels burned in, SSIM, colour-shift flags, ≤ 500 KB board; `--promote`. |
| Open plots | `shard-open-plots/art/goldens/<plot>/` | 8 views per plot (`<n>-<view>.jpg`), `cameras.json`, scored `board.jpg`; capture is shard-open-plots' own. |

| Shard repo | Slug |
|---|---|
| `shard-driftwood` | `driftwood-isle` |
| `shard-pine-hollow` | `pine-hollow` |
| `shard-nalati` | `nalati-grasslands` |
| `shard-nine-dragon` | `nine-dragon-stack` |
| `shard-sky-reach` | `far-reach` |
| `shard-dunes` | `sunscar-dunes` |
| `shard-open-plots` | open plots (8 views each) |

Before you say a shard has no goldens, run `ls ../shard-*/art/goldens/`.

## The rule (Jake, 2026-11-03)

**Any change that can alter what the player sees on a shard re-captures
that shard's 24 golden cameras on the candidate build and compares them
against the SHARDFILE goldens before it lands.** That covers render,
look, shader, material, texture, geometry, models, placement, tiles,
slabs, sky, fog, lighting, shadows, post, LOD, culling, streaming
residency, bakes and producers, and every perf cut that claims to be
pixel-identical.

- **Which shards:** a change inside one shard repo re-captures that
  shard. An engine change in render, shaders, post, the grid, shared
  kits or the format layer re-captures **all six** (two browser lanes,
  three shards each). An open-plot change re-shoots that plot's 8 views.
- **The candidate build** is a working-tree build of your change:
  engine's `scripts/serve-build.sh --shard <slug>`. After landing, a
  `--head` rerun is a QA check, not a substitute.
- **Read every panel**: each camera's row, every column. A camera is
  **red** when the NOW frame loses or gains anything against the
  SHARDFILE golden that the change did not mean to: a missing wall,
  floor, building or prop, a hole, a black or blank area, a seam, a
  different exposure or colour, a LOD or texture pop, missing hands.
  Clouds, rain, crowds, creatures and the hands' sway move between
  visits; that is not red. SSIM is a pointer, never the verdict.
- **A red camera blocks the landing.** Fix it and re-capture, or, if the
  change is a look change meant to be seen, take the update path below.
  "Pixel-identical" claims need the goldens green on Chromium **and**
  WebKit.
- **Pixel diffs, frame-floor runs, unit tests and a single spawn shot
  never count** as the look check on their own.
- **The commit carries the result:** a body line
  `Goldens: <shard> 24/24 green on <build id>` (or
  `22/24, 11 12 red: <why>, ruling <G…>`), plus the WebKit line when it
  ran, and the board committed in the shard repo as
  `art/goldens/runs/<date>-<sha10>-board.jpg`. The per-camera rows stay
  in `./tmp` and are deleted.

## The WebKit pass

The iPhone is WebKit on Apple's GPU. Add a WebKit pass when the change
touches **shaders or node graphs, blending or transparency, render
targets, the composer or post, background / clear colour or alpha,
texture formats (KTX2, mips, samplers), precision, instancing, batching,
culling or draw-call cuts, or anything sold as perf**, and whenever Jake
saw the bug on his phone: `capture.mjs --engine=webkit` for the same 24
cameras, its own board labelled `NOW webkit`. Compare structure (walls,
floors, props, sky present), not exact colour.

## Updating a golden (never silently)

A golden changes only for an **approved look change**: Jake's pick (a G
or J ruling), or a logged autonomous decision. Then, in one shard-repo
commit:
`board.py --goldens art/goldens --shard <slug> --now <raw> --promote <cams> --source "<sha10> <ruling>"`,
the board showing old golden → new, and a line in
`art/goldens/README.md` (date, cameras, ruling). A perf cut, a bug fix
or a "close enough" never updates a golden. LEGACY goldens are never
updated.

## Before saying "ready for QA"

Look at a fresh golden rerun board of the build that will be live
(`--head`, or `--rev` of the deploy pin), every panel, plus the WebKit
board when the change set had a WebKit trigger. Say which run you looked
at and how many cameras were green.
