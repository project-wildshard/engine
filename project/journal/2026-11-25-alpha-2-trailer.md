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
