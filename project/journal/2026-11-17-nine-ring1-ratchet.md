# Hold Nine's measured street workload

> Written by: Codex
> **State:** implemented, 2026-11-17.

Ring 1 only installed Nine's server slice. Its old props stall check
therefore no longer covered full Nine, and its play stall was report-only.
NB6 now builds full pinned Nine in a separate blocking CI job and runs
the standalone load profiler and NB1's 60-second street route.
The same benchmark holds geometry on software renderers and also holds
frame/load timing on hardware. Each browser takes a CPU broker slot.

Tonight's phone-tier route measured about 0.90 M triangles and 113-119
draws p95. The regression ceilings are 0.95 M and 126. Hardware timing
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

Hosted 44027299222 took 247 seconds to finish the cold client build,
leaving too little of the five-minute job for both real boots and the
60-second street route. Split producer and observation jobs, carrying
the exact client as an artifact. Both keep the five-minute cap; the
ratchet and workload are unchanged.

Qualification 44030475424 proved the producer within five minutes;
the combined observation spent its clock in full boot-smoke capture
and never reached the street. Give load and street separate matrix
legs. The load probe enters full Nine, requires real control and a
completed props stage, and uses the same CPU-profile stall refusal.
Its purpose is load evidence; existing stock visual smokes keep their
screenshots. Both observations retain five-minute caps and share the
exact client bytes. Repeat the temporary source-sleep red/green proof
against this focused load command before publication.

Tighten the first draft's 1.02 M / 132 ceilings: those would admit
removing tonight's far slab cut (0.958-0.964 M in NB23b) or bringing
back ten hoverboard draws (129). Both controls fail first against
the draft and fail correctly with 0.95 M / 126; tonight's 0.904 M /
119 and this lane's 0.911 M / 117 retain about 5-6% noise room.
NB8/NB23's improvement targets remain separate and unchanged.

Focused load proof: baseline 6.138 s, 2 s props sleep RED with
1.48 s unexplained idle, restored source/rebuild GREEN in 6.055 s.
All 17 focused cases and typed lint pass. Correct declaration import
spacing from the normal gate. M11 recovery preserves the newer
Chromium installer fix (03d9ee6f), including its headless shell.
