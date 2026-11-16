# Nine Dragon's slab chunks draw what the phone sees (NINE-DRAGON-BENCHMAX NB8, mini-ninetris)

Jake, 2026-11-15 ~17:50 Cancún: "Can you fix nine dragon, like the way it looks needs to be fixed and the FPS lol".
After NB5's `placedLodScale` the phone's spawn view on NB1 was 142 draws, 1.22 M triangles; 0.56 M of it in 37 of the
49 resident slab chunks, whose bounds span the fragment (a source-order 4 MB chunk reaches 190 m), so the object's
frustum test kept nearly all of them.

- NB9 split the slabs on the ground in the bake and measured more draws and the same spawn triangles. An offline
  simulator over Nine's real chunks and the page's real cameras (validated: it reproduces the measured 37 / 563 k at
  every pose) agrees: a k-d split at the same byte cap leaves the spawn at 39 / 587 k. What does pay is finer than a
  chunk: each chunk's triangles along a k-d tree of their centroids (middle-of-extent splits), leaves of 256 triangles with boxes, and one draw of the
  contiguous run from the first to the last leaf in view. A bake-side re-partition with the same runs measured no better
  than the engine reordering the chunk it already has, so the shard's bytes and the desktop stay as they are.
- `slabRanges.ts` reorders a phone chunk's index before its first upload and installs a draw-neutral
  `onBeforeRender` / `onAfterRender` pair that sets the run per camera and restores the full range, so shadow passes,
  warms and raycasts read the whole chunk. A chunk with no leaf in view draws one leaf, so a parked warm still builds
  its pipeline. Tier knob `slabRanges` (phone true, desktop false).
- The tree is built in linear passes (a middle-of-extent split per node over centroid arrays permuted with the ids):
  Nine's 0.70 M slab triangles take ~37 ms at CPU x1 (a count-median quickselect took ~50 ms and culled the spawn
  view 24 k better; a Morton radix sort took ~27 ms and culled every view worse). NB1 x4 readyFrame 1.1 to 1.3 s.
- NB1, phone, x4, 402×874: spawn slab 0.563 to 0.490 M (1.22 to 1.15 M), reverse 0.32 to 0.05 M, 40 m up the street
  0.50 to 0.11 M, side views 0.47-0.55 to 0.15-0.29 M. A same-instant A/B (the main scene drawn twice into its target,
  runs on and off, no frame between) differs in 0 pixels at all 8 poses.
