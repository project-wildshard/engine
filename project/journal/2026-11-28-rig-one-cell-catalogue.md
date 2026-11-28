# 2026-11-28: Nine's online walk moves on the rig

- Meta QA 11-26 row 79. With row 75's grant the walk reached control, but on the online rig the player never moved:
  0 m, stuck at x 0.95, z 7.5 (y 125) in WebKit and Chromium, with `move.forward` held or a real W key. The standalone
  boot of the same pinned client walked.
- Probed on run 46107260523's client. The online page sent its hello and then one command; the full-grid entry of the
  same page sent about 60 a second. The page's `NetPlayer.seen` stayed null: it never took an owner block, so it never
  stepped. `inCell` (clientWorker.ts) maps a frame's cell number to the page's grid cells by catalogue order.
- Cause: measure's `bootZone` enters the zone alone (zone-entry's one-cell cut of the page's inline catalogue, Nine at
  cell 1), but online-rig built its server with the checkout's whole pinned grid, where Nine is cell 7. Every frame
  named cell 7 to a page whose only cell was 1. It broke when the measured boots moved to the one-cell entry (CP12 to
  CP22, 11-25); Nine's 11-19 baseline walked 225 m [K] and 249 m [S].
- Fix: `openRig` takes `catalogue`, passed to build-server's `--catalogue`. `openOnlineBoot` writes `rigCatalogue`, the
  same one-cell cut of the built page bootZone gives the page, so the server and the page number the cell alike.
- Guard: `walkSummary` refuses a walk under `MIN_WALK_METRES_PER_SECOND` (1 m/s) of its length as SHORT, so it is not
  complete and walk-ci fails the step; a test holds the catalogue match and the refusal.
- Not changed: a rig opened with the whole grid still builds its server from the checkout's pins, so a pinned client
  whose catalogue differs from them would disagree the same way.
