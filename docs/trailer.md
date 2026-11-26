# Trailers: shot, cut, sound and titles, all in engine

> Written by: Claude (opus-trailer and opus-trailer-2, 2026-11-25), for meta ALPHA-2-TRAILER AT12. The
> tools are in `src/scripts/trailer/`, ported from singleplayer `scripts/steam-trailer/` (cf104912d3^) and
> made generic.
>
> **State:** active recipe, 2026-11-25. The alpha 2 trailer is the worked example.

Every frame comes from the game itself, posed and stepped by the capture clock; nothing is rendered
outside it. Trailers shoot the grid as players see it: every page comes in through the title's MMO card
and stands in its shot's cell, neighbours at the edges (`grid.mjs`); a zone alone (a one-cell world
through zone-entry's `alone`; no URL names a zone, J522), which no player ever sees, boots only for a shot that says
`singleZone: true`. A trailer is two data files (its shots and its cut) and six commands.

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

Play shots keep the game's own first-person camera and viewmodel; a rig lets go of it. Every shot
boots from the title's MMO card and enters its zone's cell (`grid.mjs` `enterCell`): render
coordinates are then that cell's own, so a shot's poses stay in its zone's coordinates. Helpers: `tp`, `look`, `held`, `preyNear` (stand facing the nearest live creature of a
kind), `aimAt`, `equip`, `nearest`, `NEAR_KINDS` (a probe).

## Where to shoot

Shoot on staging when its page enters and carries the capture hooks; otherwise on a local server
with the staging grid (the hosted staging page has no `window.__wildshard`, and on 11-25 every
Driftwood entry there ended REV-BEHIND):

```sh
node src/scripts/dev.mjs --staging --shard driftwood-isle --port 4420 --saves memory --no-watch \
  --work tmp/<lane>/dev
```

Without `--staging` a dev world holds only its `--shard`, one cell, which is a zone alone again. A
preview (`src/scripts/serve-build.sh --head`) hosts the release grid in the page, which can lag staging
(on 11-25 it had no Brasscap cell) and gives every page its own world, so no party. Its pages
are online (a real local server), which a party shot needs anyway. Start a fresh world for the party
shot: a world keeps a closed page's body a while, and a scout's ghosts stand where the party walks.

## The commands

```sh
# 1. scout: three stills a shot, to a sheet; then the real capture of only the frames the cut uses
node src/scripts/trailer/capture.mjs <frames> --shots <slug>,<slug> --base <url> --dry
node src/scripts/trailer/capture.mjs <frames> --shots <slugs> --base <url> --edl <cut>/edl.json
# a party shot: the party first (loopback worlds only, a cue port), then the capture on the page's
# real clock; the shot cues the march itself and its lens follows the bodies the page draws
node src/scripts/trailer/party.mjs <url> --zone driftwood-isle --at 0,-200 --go 4498 --spread 1 --secs 600 &
node src/scripts/trailer/capture.mjs <frames> --shots driftwood-isle --only d-party --base <url> --wall --sub 1 --scale 1
# 2. the build beats, from a session transcript (~/.claude/projects/…/<session>.jsonl): the ask from
# its brief, Claude's answer and the pictures it checked, sized for a phone
node src/scripts/trailer/transcript-cast.mjs <jsonl> <k>.cast --from HH:MM --to HH:MM --images <k>-img \
  --compact --cols 60 --rows 3 --ask "<words from the brief>" --prose --match "<answer>" --pictures "<path re>"
node src/scripts/trailer/panel.mjs <k>-img/images.json <k>-panel.mp4 --hold 1 --fit cover
node src/scripts/trailer/build-beat.mjs <k>.cast beat-<k>.mp4 --dur <slot> --hold 1.4 --lapse <k>-panel.mp4 --layout stack
# 3. the cut, the titles, the mix and the conform
node src/scripts/trailer/cut.mjs <cut> <score.wav> <sfx best> --cut alpha-2 --build-1 beat-a.mp4 …
node src/scripts/trailer/titles.mjs <titles> <cut>/titles.json
python src/scripts/trailer/mix.py <cut>/mix.json <mix.wav>
node src/scripts/trailer/edit.mjs <frames> <cut>/edl.json <titles> <mix.wav> <master.mp4>
```

A build beat is read on a phone, so what it shows is the ask and the answer, not tool calls (October's
review: no scratch paths). `--compact` drops blank lines and tool output; `--ask` opens on a `>` line
that must stand word for word in the session's own first prompt, or the replay refuses; `--prose`
drops the tool calls; `--match` keeps, of each of Claude's messages, only the sentence matching it;
`--pictures` keeps only the before and after shots. `--layout stack` puts the zone on top as the
larger part and the terminal in a strip under it (about 46 px type at 1080p). Give the hold at least
1.4 s so the answer stays up long enough to read.

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
(Brasscap's bandits rebuilt, Nine Dragon's flat cards made real) followed by playing where it was
built, three players walk off the Driftwood pier under the pitch line, and a low pull-back off them
over the island ends it on the end card (`g-rise-low`). The re-cut left out Mirror Salt (washed out;
its page stalls loading on local worlds), the open plots, the seam crossing and the 1050 m pull-back:
the far cells are unfinished until far views are built. Credits: MiniMax-Music3;
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
  --scale 1`. That draws about 20 frames a real second on the grid (11-25), so remote bodies
  play about 3x fast: cue the party slower (`d-party` uses 0.27 of a walk).
- A closed page's body stays in the world for 5 minutes (the server's seat hold): a probe or a
  capture that stood at a cell's (0, 0) leaves a ghost the next shot there walks through. Leave a
  zone 5 minutes after probing it before its shots, or re-take the shot.
- On the grid `window.__hf` is the home level's heightfield; a `rel` rig reads the active cell's
  ground from the player's frame queries (`capture.mjs` `tr.ground`).
- Nalati entered through the grid draws one flat colour with the AO pass on (meta AT16): its
  shots set `NO_AO` until the engine fix lands.
- A grid cell keeps its own sky and weather: the shot's `time` and `weather` reach the home level
  only, so Nalati shoots under its own dusk.
- A session's pictures can be mislabelled (a PNG type on JPEG bytes): `panel.mjs` sniffs and
  normalises them before the concat.
- A free camera starts from the player's own eye: a rig's first frames can sweep past a post.
  The capture keeps 0.25 s either side of each clip, so look at the frames from the in-point on.
- A followed party: park the capturing player away from it (`tp` inland), or its own body walks
  into the frame.
- Lint: in-page JS is strings; join them with `js(...)` or `+` between identifiers, not literals.
