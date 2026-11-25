# Trailers: shot, cut, sound and titles, all in engine

> Written by: Claude (opus-trailer, 2026-11-25), for meta ALPHA-2-TRAILER AT12. The tools are in
> `scripts/trailer/`, ported from singleplayer `scripts/steam-trailer/` (cf104912d3^) and made generic.
>
> **State:** active recipe, 2026-11-25. The alpha 2 trailer is the worked example.

Every frame comes from the game itself, posed and stepped by the capture clock; nothing is rendered
outside it. A trailer is two data files (its shots and its cut) and six commands.

## The pieces

| File | What it is |
|---|---|
| `shots/<zone slug>.mjs` | one zone's shots: light, weather, pose, rig, input |
| `shots/lib.mjs` | the loader and the in-page helpers |
| `capture.mjs` | steps the game frame by frame, writes JPEGs |
| `party.mjs` | other players for a shot, on a local world |
| `cuts/<name>.mjs` | picture, titles and sound on one timeline |
| `cut.mjs` | writes a cut's `edl.json`, `titles.json`, `mix.json` |
| `titles.html`, `titles.mjs` | the cards, rendered as PNG sequences |
| `transcript-cast.mjs` | a real session replayed as a terminal |
| `panel.mjs`, `build-beat.mjs` | that replay beside what it looked at |
| `music_scan.py` | a score take's tempo, hits and loudness shape |
| `sfx-jobs.json`, `sfx_pick.py` | trailer hits, CLAP-ranked |
| `mix.py` | the score, game sounds and hits, on the cut |
| `edit.mjs` | the conform: grade, titles, bug, mux |

## A shot

A shot file exports `shots`, an array of plain objects. The loader refuses a zone slug that is not a
cell of the live grid (`test/pins/staging.json`, J507), a light or weather the game lacks, a rig with
fewer than two keys, and a duplicate name.

```js
{ name: 'b-street', zone: 'brasscap-mesa', time: 'golden', weather: 'clear', secs: 3.5, warm: 60,
  setup: VIEWMODEL + CALM,              // in-page JS once, before the warm-up
  afterWarm: held('move.forward'),      // in-page JS after it: input, a rig, a target
  tick: (t, i, sb, step) => '',         // in-page JS every sub-frame (a trigger at `at(t, T, step)`)
  rig: { ease: true, keys: [{ t, p: [x, y, z], l: [x, y, z], fov }] } }  // a free camera
```

Play shots keep the game's own first-person camera and viewmodel; a rig lets go of it. `grid: true`
boots from the title's MMO card instead of `?chunk=`, for shots across cells (render coordinates are
the home cell's). Helpers: `tp`, `look`, `held`, `preyNear` (stand facing the nearest live creature of a
kind), `aimAt`, `equip`, `nearest`, `NEAR_KINDS` (a probe).

## Where to shoot

A preview (`scripts/serve-build.sh --head`) serves the release catalogue, which can lag the grid: a
zone missing from it fails at `admission.assets` with *Unknown built-in instance*. The staging dev
world has every cell:

```sh
node scripts/dev.mjs --staging --shard driftwood-isle --port 4410 --saves memory --no-watch \
  --work tmp/<lane>/dev
```

Its pages are online (a real local server), which a party shot needs anyway.

## The commands

```sh
# 1. scout: three stills a shot, to a sheet; then the real capture of only the frames the cut uses
node scripts/trailer/capture.mjs <frames> --shots <slug>,<slug> --base <url> --dry
node scripts/trailer/capture.mjs <frames> --shots <slugs> --base <url> --edl <cut>/edl.json
# a party shot: the party first (loopback worlds only), then the capture on the page's real clock
node scripts/trailer/party.mjs <url> --zone driftwood-isle --at 0,-186 --secs 600 &
node scripts/trailer/capture.mjs <frames> --shots driftwood-isle --only d-party --base <url> --wall
# 2. the build beats, from a session transcript (~/.claude/projects/…/<session>.jsonl)
node scripts/trailer/transcript-cast.mjs <jsonl> <k>.cast --from HH:MM --to HH:MM --images <k>-img
node scripts/trailer/panel.mjs <k>-img/images.json <k>-panel.mp4 --hold 0.8
node scripts/trailer/build-beat.mjs <k>.cast beat-<k>.mp4 --dur 5 --hold 0.8 --lapse <k>-panel.mp4
# 3. the cut, the titles, the mix and the conform
node scripts/trailer/cut.mjs <cut> <score.wav> <sfx best> --cut alpha-2 --build-1 beat-a.mp4 …
node scripts/trailer/titles.mjs <titles> <cut>/titles.json
python scripts/trailer/mix.py <cut>/mix.json <mix.wav>
node scripts/trailer/edit.mjs <frames> <cut>/edl.json <titles> <mix.wav> <master.mp4>
```

Captures take `desktop-gpu.lock` (capture.mjs takes it itself) and at most three browsers run at
once. The score and SFX models take `~/projects/localai/.model.lock`. Scratch goes in `tmp/<lane>/`;
no frame, video or WAV is committed.

## Sound

- **Score:** MiniMax Music 3, a jobs file beside the cut (`alpha-2-jobs.json`), several seeds.
  `music_scan.py` prints each take's tempo, hits and per-second loudness; pick the take whose shape
  lands the cut's turns, then time the cut to its hits.
- **Trailer hits:** `sfx-jobs.json` families, two seeds each from MOSS-SoundEffect v2 and Stable Audio 3
  Medium; `sfx_pick.py` keeps the CLAP winner as `tr-<family>.wav` (`tr:<family>` in a cut).
- **Game sounds:** `game:<name>` in a cut reads the game's own files.
- Nothing is ever played aloud while working: levels and shapes are read from the scans.

## The alpha 2 trailer

`cuts/alpha-2.mjs`, about 60 s at 16:9 (meta J520). Play and build interleave: it opens on play, the
title follows the first shot, each build beat is a real Claude Code session from the last 30 days
followed by playing where it was built, a party of three walks the beach, a crossing goes over a cell
seam with no loading panel, and the grid pull-back ends it on the end card. Credits: MiniMax-Music3;
MOSS-SoundEffect v2 and Stable Audio 3, Powered by Stability AI; Captured in engine; Built with
Claude Code.

## Honesty rules

- **Every frame in engine.** Play and scenery are the game's own frames on the capture clock;
  the build beats are real sessions' own lines and the pictures they read. Nothing is painted,
  rendered elsewhere or composited into a world shot but the titles.
- **The alpha label on every frame.** The corner bug (*ALPHA 2 · IN ENGINE*) sits over every
  clip but the end card's hold, which carries its own alpha line.
- **Only zones live on the grid.** The shot loader refuses a slug that is not a cell of the live
  staging pin; a zone not on the grid is not in a trailer.
- **Promise only what ships.** A party is a few real clients, not a crowd; a fight is a creature
  the zone spawns, not a boss summoned by a hook the game lacks.

## Gotchas

- A boot that never readies is usually a zone the build's catalogue lacks (*Unknown built-in
  instance*). A warm-up that stalls logs the page's state; the world watch's error card was one
  (a rig in Nine Dragon's shaft), and the capture now answers its looks.
- On the dev world's online page the creatures are the server's: shoot fights on the solo
  preview. A creature's entry is recycled when it dies; aim with `PREY`, found again each tick.
- A virtual clock and remote players disagree: capture party shots with `--wall --sub 1
  --scale 1` (about 0.03 s a frame, so remote bodies move close to their real pace).
- A session's pictures can be mislabelled (a PNG type on JPEG bytes): `panel.mjs` sniffs and
  normalises them before the concat.
- Lint: in-page JS is strings; join them with `js(...)` or `+` between identifiers, not literals.
