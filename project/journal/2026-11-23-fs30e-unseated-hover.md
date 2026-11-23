# FS30e: a hover tap before the seat, and seat evidence for the Clockwork key (opus-flow2)

- Found while chasing FLOW-SIMPLE FS30e: on an online page that opened unseated (OF10), a HOVER tap played on the
  predictor alone and the seat's first frame took the server's board, so the board flicked on and dropped. The first
  seated step now carries the toggle. Red first in `test/net-hover-slow-frames.test.ts`.
- The Clockwork nightly page boots with its server, so this is not that key's cause. `nightly-heads.ts` now writes the
  seat (joined, corrections, full ring), app state and carry into `hover.json`, and `NIGHTLY_CPU_THROTTLE` slows local
  Chromium to the hosted ~2.7 fps for a repro.
