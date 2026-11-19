# The ledger reads each boot step after a GC

Main run 44418154411 (41b1b4fd) went red on memory-ledger-guard:
brasscap-mesa peak loading 47,712,804 B > 47,407,792 B (baseline
46,478,228 B + 2%). Neither pushed commit touched brasscap-mesa
(528d4df3 is Pine's KTX2 rows, 41b1b4fd is staging QA).

The six main runs since 61da931d boot the same brasscap-mesa build and
read the same control after the GC (22,376,824 B array-buffer), but the
loading peak at `finish` read 37.8, 42.8, 45.8, 45.8, 45.8 and 47.1 MB
array-buffer. In the red run, 1.23 MB that other runs dropped between
`gameplay` and `shaders` was still counted at `finish`. The ledger
counts a buffer through a weak ref until a GC clears it
(memoryAttribution.ts), so a step's read holds whatever garbage the GC
has not yet reached. b6266a18 settled control the same way for Nalati;
the peak had the same problem.

STEP_LOG now calls `gc()` before a step's ledger read when the run sets
`__memoryRun.settle`. Only the ledger-only Chromium boot (the hosted
gate and its negative control) sets it and launches with `--expose-gc`.
The dump microscope, census and WebKit runs read as before. The planted
20 MB buffer is retained, so the negative control still trips.

Peaks now count live bytes, so they read at or under the recorded
baselines, which were taken with garbage in them. Re-recording the
ledger baselines would tighten the line again; that is codex-memgates'
call.

## Follow-up: the GC hangs the boot

A local boot of run 44418154411's pinned client through the new path
stalled at `modules` three times out of three, with every Read Model,
Program, Texture and Product data wait still open. The same client with
the pre-fix script, or with only `--expose-gc` and no gc() call, boots
to control. So a full GC during `modules` loses in-flight reads: a real
engine bug, since a phone collects whenever it likes. The per-step GC
comes out again so the gate does not hang; the peaks keep their noise
until the hang is fixed.
