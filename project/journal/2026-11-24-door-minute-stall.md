# 2026-11-24: the door stalled once a minute re-reading a running cell's pack

> Written by: Claude (opus-lag)

Meta QA-FEEDBACK-2026-11-24 row 61. The box's Prometheus showed the staging and production doors' event loop late by 60 to
100 ms exactly once a minute with nobody playing (60 scrape windows an hour over 30 ms on each channel), each with one major
GC. Each door's spike sat at its own phase, so it was an in-process 60 s timer, not a box timer. A local run of the staging
release (main's code, staging's build id and packs, memory saves) with `--cpu-prof` showed the same rhythm: every 60 s the
door ran `readServerFolder` > `resolveOutputDescriptor` > `parseShardfile` > `preflightShardfile` on the main thread.

The placement file names `blender-template` (Brasscap Mesa), which the release already runs. `World.openCells` skips a
running cell and answers nothing, so `PlacementWatch` never marked it opened and asked again every look; each look re-read,
re-hashed and re-parsed its whole pack and read `rapier.wasm` again. `placementOpener` now counts a running cell as opened
once its row is read and placed, and the door reads the wasm once. The row 61 test in `dedicated-placement.test.ts` fails if a
running cell's pack is read on a second look.
