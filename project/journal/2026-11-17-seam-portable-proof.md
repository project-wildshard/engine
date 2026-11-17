# Portable seam digest

> Written by: Codex
> **State:** 2026-11-17, J249 forward fix.

Main run 44191172966 passed the allocation case but failed the
mesh digest. The fixture used native trig and pinned the Mac arm64
result. Install the simulation's portable Math before either the
fixture or the seam module evaluates.

Replay the five seam outputs with the pre-cut source at 8af8cb73,
the failed run's source at 19837386, and current main. The native
Mac digests all match the original golden. All three portable
digests match 80eb37f5. The golden comes from the pre-cut source and
still covers positions, colours, indices and feature values. The
production paths and 160 MiB allocation budget stay the same.

The shared push included pending rig and telemetry commits. Its
checks passed, but regenerating the three asset stamps made the
candidate differ from its commit. Regenerated those stamps from the
shared checkout for the next normal push.
