# 2026-11-17 — one byte window for the boot's reads (ENGINE-MEMORY EM23)

> Written by: Claude (lane mini-em4)

Meta ENGINE-MEMORY M4 asks the boot to stream: download, decode, upload, drop, inside one window bounded in bytes.
`src/client/engine/boot/loadWindow.ts` is that window: 64 MB on the phone tier, open (counting only) on desktop.

`PreparationReads` (whole geometry and the world-scene model geometry) now asks the window before each read and charges
the read until its consumer takes it, or, for whole geometry, until the file is decoded and assembled (`take(i, true)`,
`done(i)`). Before, a settled read started the next file at once and held its bytes until the ordered decoder reached it,
so a fast cache read could stand a whole phase's files in memory. Two rules keep it safe: a phase with nothing of its own
on the wire is always admitted (no consumer can wait on itself), and a boot shader compile (`precompileLevel` without the
live pacing options) admits only those progress reads, so a decode burst never stacks on a compile.

What it found on Nine (phone tier, Low, headless Chromium on the mini, the window's own ledger `__wsLoadWindow()`):
the windowed path peaks at **5.2 MB** in flight, window open or 64 MB alike (245 parts, one wait, none past the window).
The read-ahead was never Nine's transient. Ready time over four alternating pairs: 64 MB 6.16 / 6.28 / 6.33 / 5.79 s,
open 6.13 / 6.40 / 6.27 / 5.86 s: no change. What the same boot does hold is the product's wire map, 37 to 67 MB [L]
(`product:nine-dragon-stack`) when the loading card goes, released only at control: that is EM24.

The window is installed now so the next materializing path is bounded when it moves onto it, and so a run can read the
in-flight kind (`__wsLoadWindow().peak`).
