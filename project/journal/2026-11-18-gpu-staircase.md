# The GPU feature staircase

> Written by: Claude (mini-memstruct-m5), 2026-11-18. Meta MEMORY-STRUCTURE STR28.

`scripts/memory/gpu-staircase.mjs` opens `gpu-staircase.html` in a cold Playwright WebKit at the phone view and changes
one GPU feature at a time from a phone-Low WebGL2 canvas cleared every frame: context attributes, drawing-buffer ratio,
vertices and live varyings in one pass, render-target formats and full-screen DOM layers. It reads the settled [K]
footprint of WebContent and the GPU process (measure.mjs's reading) and splits the GPU process by `footprint` category.
The page is served by the script only; it is not in the client build.

Three rounds on the Mac mini, spreads under 1 MB on most steps. What the game still pays, per step:

- The WebGL context: 101 MB over a blank page, 91 MB of it Metal-owned graphics, at any canvas size.
- The tiler parameter buffer: about 30 B per vertex plus 29 B per live vec4 varying (7 B per component) per vertex in
  the heaviest pass, kept at its high-water. Fourteen float varyings cost 187 MB at 1 M vertices against 151 for four
  vec4: scalars carry overhead, but components dominate.
- A full-screen composited layer: 13.0 MB of IOSurface at device scale 3, whatever its drawing; hidden, opacity 0 and
  small layers cost nothing. Plain full-screen divs over the canvas composite too (overlap).
- Three 402 x 874 RGBA16F targets: 17.6 MB; any 32-bit format: 12.6 to 12.9. The format change is worth 5 MB.

Numbers and the ranking: meta `docs/plans/engine-memory/gpu-staircase-2026-11-18.md`.
