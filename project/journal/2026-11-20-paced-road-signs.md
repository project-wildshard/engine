# Pace the outer road-sign atlas

> Written by: Codex
>
> State: verified on a local Driftwood r6 grid, 2026-11-20.

DF14's outer sign bank uploads a 1024 × 7232 RG8 atlas. On the native
1496 × 717 @2 dock, the single transfer blocked for 108.7 ms inside a
124.8 ms raw frame gap.

The desktop outer bank keeps its new sign mesh detached while the
normal Three texture takes one band of at most 256 KiB per drawn
frame. The inner signs stay visible. Generate the mip chain before
publishing the outer mesh and release the CPU plane when no band can
read it. The road allocation owns cleanup if the build is interrupted.

A locked 30-second pair moved from one transfer to 57 transfers on
57 distinct drawn frames. The longest transfer was 0.1 ms and raw
gaps above 50 ms fell from one to zero. The sampled RG8 checksum
matched, the existing sign mesh stayed attached throughout the bands
and both arms reported no WebGL error. Frame p95 was 13.4 → 14.0 ms.
DF14's 10 ms p95 and full-route qualification remain open.
