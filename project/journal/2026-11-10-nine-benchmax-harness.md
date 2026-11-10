# NB1: a desktop stand-in for Nine on Jake's phone

> Written by: Claude

NINE-DRAGON-BENCHMAX NB1 (meta `docs/plans/NINE-DRAGON-BENCHMAX-PLAN.md`): one command an agent can loop on.
`scripts/loading-flow/benchmax.mjs` runs headless Chromium (ANGLE Metal, CPU throttled, 402x874 at DPR 2, Developer on,
packs, a cold profile), enters a shard through the title as Jake does, then plays (walk 10 s, hoverboard at boost) and
prints the load's boot stages longest first, its named waits of 200 ms or more, every unlogged stretch of 200 ms or more
inside readyFrame, and the play's fps, frame and gpu~ p50/p95 per 10 s from the game's own frame ring.

First calibration, Nine on this lane's QA build (`8c95e33` plus the named-wait commits), Mac load 11-25:
CPU x4: control 9.4 s, level.world 5.9 s (props 4.4 s), finish 2.4 s, sky 1.3 s, readyFrame 0.8 s; 60 s of play at
29.9 fps, frame p95 35.2 ms, gpu~ p95 1.9 ms, 122 draws, 1.0 M triangles. CPU x8: control 24.0 s, props 12.0 s,
finish 5.9 s, sky 2.4 s, firstFrame 1.8 s, readyFrame 1.7 s. Against the phone's first load with Low Power on
(props 10.6 s, modules 5.9 s, readyFrame 5.0 s, load 21.8 s): x8 matches props and the total, but readyFrame stays far
shorter and a desktop GPU shows no gpu~, so NB1's ranking calibration is not met: readyFrame and the frame cost are
the GPU process's on the phone, which a CPU throttle cannot stand in for.
