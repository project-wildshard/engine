---
name: goldens
description: Re-capture a shard's 24 golden cameras on an engine build and compare them against that shard repo's known-good SHARDFILE goldens, as a labelled LEGACY golden · SHARDFILE golden · NOW board, reading every panel and marking red cameras. Use for "goldens", "golden images", "re-run the goldens", "regression check", "did this break the look", "before landing a render / look / shader / LOD / culling / perf change", "is shard X ready for QA", "does Nine have goldens", or any claim that an engine change is pixel-identical. Not for new mockups or memory / fps readings.
---

# Goldens: re-capture and compare (engine)

> Written by: Claude (opus-k9, REPO-KIT K9, 2026-11-11). Carried from singleplayer's goldens skill.

Read [docs/goldens.md](../../../docs/goldens.md) first: where every set
lives, the rule (a look change re-captures its shards' 24 cameras on the
candidate build and lands only with every camera green), the WebKit
triggers and how a golden is updated. The harness is here in engine
(`scripts/goldens/`); the frames are in each shard repo's
`art/goldens/`, a sibling checkout. Each shard repo also has its own
goldens skill for shard-only changes. Subagents: a capture is a long
wait (~10 min a shard); commit what you have and hand the exact capture
command back.

## 1. Find the set

```bash
ls ../../shard-*/art/goldens/ 2>/dev/null || ls ~/projects/games/wildshard/shard-*/art/goldens/
SHARDS=~/projects/games/wildshard
REPO=shard-dunes SLUG=sunscar-dunes          # the repo → slug table is in docs/goldens.md
G=$SHARDS/$REPO/art/goldens                  # cameras24.json, shardfile/, legacy/, README.md, runs/
ls $G/shardfile/                             # <nn>-<camera>.jpg, the look to hold
```

Never tell anyone a shard has no goldens without running that `ls`. An
engine render, shader, post, grid, kit or format change runs **all six**
shards.

## 2. Serve the build

```bash
SHA=$(git rev-parse HEAD)                     # record before the build: HEAD moves while peers land
# candidate (your uncommitted change, before it lands):
URL=$(SERVE_OWNER=goldens-$SLUG scripts/serve-build.sh --shard $SLUG --name goldens-$SLUG --hours 1)
# landed commit (QA check): ... scripts/serve-build.sh --head ...   or  --rev <sha> (then SHA=<full sha>)
PORT=${URL##*:}; PORT=${PORT%/}
```

## 3. Capture the 24 cameras

```bash
RUN=tmp/goldens/$(date +%F)-$(git rev-parse --short=10 $SHA)-$SLUG
scripts/browser-lane.sh --max 20 node scripts/goldens/capture.mjs --base=$URL --sha=$SHA \
  --cameras=$G/cameras24.json --mode=shardfile --shards=$SLUG --out=$RUN/raw
# WebKit pass (docs/goldens.md triggers: shaders, render targets, clear, blending, textures, culling, any perf cut):
scripts/browser-lane.sh --max 25 node scripts/goldens/capture.mjs --base=$URL --sha=$SHA --engine=webkit \
  --cameras=$G/cameras24.json --mode=shardfile --shards=$SLUG --out=$RUN/raw-webkit
```

- `--sha` must be the commit the preview was built from (capture refuses
  a mismatch). `--cams=11,12` re-captures some. Never `--mode=legacy`:
  the LEGACY goldens are frozen.
- Engine-wide change: all six, two lanes in parallel, each `--max 40`,
  with `--cameras=scripts/perf/cameras24.json` (all six shards'
  cameras): `--shards=driftwood-isle,pine-hollow,nalati-grasslands` and
  `--shards=far-reach,sunscar-dunes,nine-dragon-stack`.
- Check `$RUN/raw/receipts-$SLUG.json`: `status` `complete`, `errors`
  empty. A pose with `idle.settled: false` or `live.settled: false` was
  still streaming: re-capture it with `--cams` before calling it red.

## 4. Build the board and read every panel

```bash
python3 scripts/goldens/board.py --goldens $G --shard $SLUG --now $RUN/raw --out $RUN/board --label "NOW $(git rev-parse --short=7 $SHA)"
python3 scripts/goldens/board.py --goldens $G --shard $SLUG --now $RUN/raw-webkit --out $RUN/board-webkit --label "NOW webkit"
```

It prints SSIM and the colour shift per camera against the SHARDFILE
golden and writes `$RUN/board/<nn>-<camera>.jpg` (one row per camera:
LEGACY · SHARDFILE · NOW, labels burned in) and `board-$SLUG.jpg` (all
24, ≤ 500 KB). Python needs Pillow and NumPy.

**Open every `<nn>-<camera>.jpg` with the Read tool, all 24**, lowest
SSIM first but never only those. Red = NOW lost or gained something the
change didn't mean to against the SHARDFILE golden: a wall, floor,
building or prop missing, a hole, black or blank areas, seams, exposure
or colour shift, LOD / texture pops, hands missing. Moving clouds, rain,
crowds, creatures and the hands' sway are not red. On WebKit judge
structure, not exact colour. Burn the verdict in with the same command
plus `--red 11,12`.

## 5. Report, land, clean up

- **Any red camera: don't land.** Fix and re-capture those cameras, or
  (a look change meant to be seen, with Jake's ruling) promote in the
  shard repo:
  `board.py --goldens $G --shard $SLUG --now $RUN/raw --promote 11,12 --source "<sha10> <ruling>"`,
  plus a line in `$G/README.md`, committed in that shard repo.
- Green: copy the board to `$G/runs/<date>-<sha10>-board.jpg`, commit it
  in the shard repo by pathspec, and put
  `Goldens: $SLUG 24/24 green on <build id>` (and the WebKit line) in
  the engine commit body.
- Report: the run, green / red counts, red cameras with one line each,
  the board path. Show Jake the board, not SSIM.
- `scripts/serve-build.sh stop $PORT`, then `rm -rf` the exact `$RUN`
  path.

## Open plots

The plot set and its capture belong to `shard-open-plots`
(`art/goldens/<plot>/`); run its goldens skill from that checkout.
`board.py --goldens <shard-open-plots>/art/goldens --plot <plot>` builds
the GOLDEN · NOW board.
