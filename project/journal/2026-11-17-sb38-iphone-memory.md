# SB38: iPhone Safari memory kill while Playing (opus-bugbash4)

- Measured staging v0.1.36 in headless WebKit at 402x874 @3 with `phys_footprint` of the WebContent and GPU processes
  (the ledger says ~265 MB; the processes hold ~1.46 GB + ~0.7 GB at Playing). WebContent climbs from 1.15 GB at
  gameplayReady to 1.8 GB three seconds later: the grid's placements changed since the build (auto-placed uploads),
  so the compiled road misses and the page builds every seam and the road itself, beside the far ring.
- Cut 1: the seam lattice's certification allocated ~970 MiB a varied seam (filtered row copies per candidate, a tuple
  per visited triangle, closures and scratch per triangle error). Now ~85 MiB, byte-identical meshes (digest test).
- Cut 2: the road clip's cut triangles (Float64Array + object a vertex, arrays a polygon) now clip in reused scratch;
  1,244 to 241 bytes a triangle, byte-identical (digest test); WebKit road install peak -56 to -63 MB.
