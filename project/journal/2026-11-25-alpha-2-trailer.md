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
