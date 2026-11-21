# Nine's load waits while the boot moves

buddy-engine, 2026-11-20, engine red 44847945386 (Coordinator CLAIM).

`nine-ring1 (load, ubuntu-latest)` failed twice today on
`page.waitForFunction` at its flat 235 s, and was green in between.
The wait polls Nine's readiness: the level, a drawn frame, the HUD
entered and unpaused, the frame gate, no loading screen.

The 235 s came from six hosted totals of 98-166 s. Those totals were
`elapsedMs`, which also holds setup and the memory reads after
readiness; readiness was never logged. Today's thirteen green Ubuntu
runs logged totals of 138-301 s, so several passed within seconds of
the line, and the red's receipt had no timeline at all: the page was
too busy to answer the 5 s read after the timeout.

Locally, on SwiftShader against the same CI client, Nine is ready in
27-30 s, and firstFrame is about 14 s of it, after 4 s of shaders.
The hosted runner is about 8.4x slower (a 227 s total against 27 s),
so its firstFrame alone is near two minutes. That is the slow step,
and it is SwiftShader compiling and drawing the first frame, not a hang.

So the wait is now bounded by progress: `waitNineReady` polls every
5 s, and fails when no boot step finishes and no frame is drawn for
150 s, or at 420 s (the 10 min job less its measured non-boot work).
It logs where it stands every 30 s, records `readinessMs` and every
stage's time in `load.json`, and a failure writes the last state it
saw. Next time these numbers move, there is readiness data to move them.
