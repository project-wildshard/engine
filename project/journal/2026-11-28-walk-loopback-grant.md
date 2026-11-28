# 2026-11-28: Nine's Chromium walk reaches control again

- Meta QA 11-26 row 75. Every sampled memory-footprint run from 11-26 on (46100970800 among them) had Nine's [S]
  Chromium walk stall at loading step `server` for its 180 s timeout, re-reading `/release.json`, and walk-ci only
  warned, so nothing was judged.
- Reproduced locally on that run's pinned client. The page console said it: "Access to fetch at
  'http://127.0.0.1:<release port>/release.json' ... blocked by CORS policy: Permission was denied for this request to
  access the `loopback` address space." The online rig serves the page, its release file and its world on three loopback
  ports, and Chromium 158's Local Network Access check denies that cross-origin read in a headless browser. The page
  showed "Can't find the world" and never dialled. WebKit has no such check, so its walk passed. Not the PV30 kind (a
  cooked page reading from its own origin); production reads its release file from a public origin.
- Fix: `loopbackWorld` grants the page origin `local-network-access` on the walk's Chromium context before its page
  opens, as the cooked-zone proofs already do. With it the walk reached control in 5 s and completed.
- Guard: walk-ci fails the step when the first walk never completes (was a warning), and a test holds the grant and that.
- Found on the way, not fixed here: on the rig's online boot the player never moves (0 m, stuck at x 1, z 7.5 in both
  WebKit and Chromium); the standalone boot of the same build walks. The judged rate is idle traffic until that is fixed.
