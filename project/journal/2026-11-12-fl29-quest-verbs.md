# 2026-11-12: FL29 quest-verbs Nalati child under load

- Strike: opus-ov7's v0.1.11 `--prepare` (02:31 UTC, 1-minute load 25):
  `headless-quest-verbs-nalati` read `expected null to be +0`, the
  spawnSync child killed at its 30 s guard. It passes alone.
- Where the time goes, alone, one child: 3.4 s wall, ~6 CPU-s. Main
  thread imports 0.3 s, product load 0.45 s (`loadHeadlessProduct` 0.3
  CPU-s, 331 files, 194 MB); then the tick worker boot, 1.8 s: its own
  module graph (~0.6 s), the asset admission run in both parent and
  worker (~0.5 CPU-s each), the product loaded again in the worker, and
  the initial full-world checkpoint the tape never reads (~0.5 s:
  `encodePhysicsReferences` plus deflate). Then the 4,103-tick tape,
  0.9 s. About three quarters is boot that every Nalati native child
  pays; nothing in this file repeats.
- Red: 30 nice-10 copies plus 30 nice-0 busy loops took each child to
  34 s; the real Vitest file failed 1/1 with the strike's message. At 36
  copies and 36 loops the original code failed 2/2 (30.8 s, status null).
- Fix: the 30 s kill is a hang guard, not the time budget. J193's 60 s
  file cap is the budget, and the ordinary Nalati native children guard
  at 175 s. The shared `questVerbCases` child now guards at 55 s inside a
  60 s case (Driftwood and Far Reach share it), and a killed child names
  its signal instead of a bare `null`.
- Green: at 36 copies the new code passed 4/4 at 34-38 s, each past the
  old guard, before the coordinator stopped the stress run (load 92 was
  timing out other lanes). Then 12/12 in a row at 8 copies and 8 loops
  (1-minute load 21-25, 6.5-8.7 s). That run shows stability only; the
  old guard would also pass there. The 4/4 at 36 copies is the proof
  that the change is what turns red into green.
- Not done here, for TS4/TS7: the worker's initial checkpoint on a
  verb-tape worker and the doubled admission and product load are the
  cheapest Nalati boot cuts; both are shared by ~25 native files.
