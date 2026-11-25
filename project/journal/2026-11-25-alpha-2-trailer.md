# The alpha 2 trailer's tooling (meta ALPHA-2-TRAILER)

- AT1: the trailer capture is back from singleplayer `scripts/steam-trailer/` (cf104912d3^) as
  `scripts/trailer/capture.mjs` and `shots/lib.mjs`, generic this time: a shot file is
  `shots/<zone slug>.mjs`, each shot names its zone, light and weather, and the loader refuses a
  slug that is not a cell on the live grid. The port: no URL switches (poses and weapons go
  through the probe in `setup`), the gate wraps the game's own frame gate (so a cell that is not
  ready still holds the frame), `performance.now` / `Date.now` on the capture's virtual clock,
  every page element but the world canvas hidden (views.mjs's god-view trick), and the whole run
  under `desktop-gpu.lock`. Plan worktrees were at the cap of 10, so this goes through
  engine-quickfix and main-push. Dry run on Driftwood: 5 shots, 3 stills each, 0.07 s a frame
  at 3840 × 2160.
- AT2: cut, titles, mix, conform, build beat, SFX pick and music scan are back in
  `scripts/trailer/`. A cut is a data file (`cuts/<name>.mjs`); cut.mjs hands it every other
  `--key value`, so the alpha 2 cut takes its build beats and bug by name. The conform's grades
  are keyed by zone slug, and a clip can now be a held `still` (the smoke cut of dry stills).
  mix.py finds the game's hashed sounds (`<name>-<take>-<hash>.m4a`); sfx_pick.py reads CLAP
  from sharddev's audio tools and no longer doubles the `tr-` prefix; build-beat.mjs takes its
  panels as `--lapse` arguments instead of Sky Reach's fixed paths. The node tools are
  importable (`import.meta.main`) so the push gate finds their tests, and `scripts/trailer/**`
  sits beside look-loop/views.mjs in the scripts tsconfig's exclude list (capture scripts full
  of in-page JS strings).
- AT7: the build half is real sessions, not hero-card time-lapses (the hero cards in the
  zone repos barely change over 8–31 revisions). `transcript-cast.mjs` replays a Claude Code
  session transcript as an asciicast: every line is the session's own text, tool call or
  result, on a compressed clock; secrets and the home folder are scrubbed. The transcripts
  embed the pictures the session read, so `--images` pulls them out with their moments, and
  `panel.mjs` turns them into the video build-beat.mjs shows beside the terminal (pictures
  normalised through sharp first: sessions read PNG, JPEG and mislabelled files, and the concat
  demuxer wants one codec). Three beats: Brasscap's Dust Wyrm, Mirror Salt into the engine,
  Nine Dragon's look pass. Code-point slicing, not UTF-16: a cut surrogate broke ffmpeg.
- AT9: the title cards take their words from the cut instead of the first trailer's: the alpha
  card a kicker, a big line (HTML) and a sub; the corner bug its pill (`ALPHA 2 · IN ENGINE`); the
  end card a second call to action (`Build your own zone with Claude Code`), the alpha line and
  the credits. Captions use `bigcap` (76 px Rajdhani, about 52 px cap height: over J520's 44).
- AT3–AT6, AT10's cut: shot files for seven zones plus the grid (`shots/<slug>.mjs`), all
  scouted dry at HEAD (the board: claude.ai artifact 1r2S4huyeyyZhPAHMgtbwp). Surprises: the
  preview's catalogue lags the grid (Glowfen, Mirror Salt and Mossgate fail at
  admission.assets: *Unknown built-in instance*), so those and the grid shots run on the
  staging dev world (`dev.mjs --staging`); on that online page the creatures are the server's,
  so fights shoot on the solo preview. Nine Dragon's shaft rig paused on the world watch's
  error card (a look read the shaft's clear colour as an undrawn world): the capture now
  answers the watch's 48 px looks itself, and a warm-up stall logs what the page says. A
  creature's entry is recycled when it dies, so fights re-find their prey every tick (`PREY`).
  `party.mjs` puts three real clients in a local world for the party shot, captured with
  `--wall` (remote bodies move on the page's real clock). `cuts/alpha-2.mjs`: 19 clips, 63 s.
- AT12: `docs/trailer.md`, the re-make recipe (pieces, a shot, where to shoot, the commands,
  sound, the alpha 2 cut, the honesty rules, gotchas). The corner bug now sits over the build
  beats too, so every frame but the end card's hold carries the alpha label.
