# 2026-11-23 nightkill (mini-nightkill, DF7)

- The DF7 night (launchd io.wildshard.driftwood-fps) died by SIGTERM five times today. Cause: meta's SubagentStop
  cleanup (`.agents/hooks/subagent-cleanup.mjs`) took the night's lockf for a lane orphan in `engine/tmp/df7-nightly`
  (ppid 1, no tty) whenever a lane that kickstarted it, or cd'd there to read its log, stopped. `~/.cache/wildshard/autoclean.log`
  has each kill to the second of launchd's exit. Fixed in meta 3d177c09 (cleanup spares launchd jobs).
- Here: a night killed past its SIGTERM handler left its detached world on tmp/df7/world (PID 61306, four hours) beside
  the next night's. nightly-mini now records the world's group in tmp/df7-world.pgid and the next night stops it first.
