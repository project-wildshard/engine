# Nalati's flat frame was n8ao's triangle, zero-filled (opus-ao16, meta ALPHA-2-TRAILER AT16)

- Nalati entered through the grid drew one flat colour (black, olive, tan, lavender as the camera moved) with the AO pass
  on. Reproduced on the trailer's own capture path against a local staging grid, Metal: every frame read a spread of
  exactly 0 per channel; with the AO pass off the same frame read 17-45.
- Read in the frame: the scene buffer was whole, but every n8ao target after it (its AO, its blur, its compositer output)
  was one value. n8ao's FullScreenTriangle geometry had uv `[0,0,0,0,0,0]`, position intact. Every AO quad sampled one
  texel, so the compositer wrote the scene's corner texel over the whole frame.
- The Memory saver (memorySaver.ts) lets a drawn geometry's arrays go once they are on the GPU. n8ao's triangle is one
  module geometry for every AO pass, and each quad's dispose disposes it. A composer rebuild in the page deleted its
  buffers; the next AO pass uploaded it again from the released uv, which `restore` hands back zero-filled when the
  buffer is gone. postprocessing's triangle hit this before (J451) and was excluded by name.
- `screenGeometry` now keeps every screen pass's triangle or quad (no parent, never culled, at most four vertices) whole.
  memory-saver-boot-release.test.ts disposes a real N8AOPostPass and reads the triangle back (fails on the old code with
  24 bytes released). src/scripts/trailer/flat-frame-check.mjs boots a zone through the MMO card and its cell with AO on and
  fails on a flat centre: it read spread 0 on the old build.
- The trailer's Nalati shots drop `NO_AO`.
