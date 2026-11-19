# J451: the world read transparent after an in-page zone entry

> Written by: Claude (opus-tr4b7), 2026-11-19

QA 11-19 row 17 / J451's zone-entry smoke: after Driftwood to Sky Reach in the same page, the loop ran (30 fps, frames
counting, gate open, context alive) and the scene pass filled the composer's input buffer, but the canvas read fully
transparent, so world-watch opened its fatal card. Chromium reproduces it too, on preview v0.1.50.

The cause is the Memory saver and postprocessing's shared fullscreen triangle. `Pass.fullscreenGeometry` is one module
geometry every composer on the page draws. After 240 renders (or the boot's `releaseDrawnGeometry`) the saver let its
position and uv arrays go. A same-page entry disposes the old composer, which disposes that geometry and deletes its GPU
buffers; the next composer's first draw uploads it again from its arrays, and a released array read after its buffer is
gone comes back zero-filled (`[memory saver] a released attribute was read after its geometry was disposed`). Every
fullscreen pass then drew a degenerate triangle: nothing reached the canvas.

Proof on preview: read after the entry, the triangle's position was `[0,0,0,...]`. A probe that happened to read the
arrays before the entry (restoring them while the buffers still existed) made the bug vanish.

Fix: the saver skips `Pass.fullscreenGeometry`, as it already skips three's shared sprite quad. Test:
`memory-saver-boot-release.test.ts` "phone keeps the composer fullscreen triangle readable for the next composer"
(failed with 60 bytes released before the fix).
