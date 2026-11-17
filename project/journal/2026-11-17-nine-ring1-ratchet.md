# Hold Nine's measured street workload

> Written by: Codex
> **State:** implemented, 2026-11-17.

Ring 1 only installed Nine's server slice. Its old props stall check
therefore no longer covered full Nine, and its play stall was report-only.
NB6 now builds full pinned Nine in a separate blocking CI job and runs
the stock standalone bootCase, followed by NB1's 60-second street route.
The same benchmark holds geometry on software renderers and also holds
frame/load timing on hardware. Each browser takes a CPU broker slot.

Tonight's phone-tier route measured about 0.90 M triangles and 113-119
draws p95. The regression ceilings are 1.02 M and 132. Hardware timing
allows 25 fps, 65 ms frame p95, 30 ms gpu~ p95, 40 s control, 6.5 s
shaders and 8 s firstFrame. These permit shared-machine noise; NB8 and
NB23 retain their separate improvement targets. Missing minutes,
wrong tier/DPR, a wedged route or missing street legs cannot pass.
SwiftShader reports timing rather than pretending to measure a phone.

Local M5 Pro, full pinned Nine rev 2, phone 402x874 @2, CPU x4:
0.911 M triangles, 117 draws p95; 29.4 fps, frame p95 40.1 ms,
gpu~ p95 6.8 ms; control 14.4 s, shaders 0.87 s, firstFrame 1.22 s.
All 27 waypoints reached with no stuck recovery. Baseline boot green.
A temporary 2 s sleep in session/data.ts's props callback made this
same standalone check exit 1: 1.49 s unexplained idle in 1.5 s.
The source mutation was removed before committing; the healed build
and hosted observations are recorded in the meta NB6 evidence.

The normal push gate caught an optional `world` read in the new renderer
report. Use the existing `requireWorld()` accessor after control; the
browser has already proved the world exists there. No gate bypass.

M11 held the original change when J400 rewrote ci.yml concurrently.
Reapply the isolated Nine job beside the current nine-share products
layout; preserve the current workflow and the typed accessor fix.
