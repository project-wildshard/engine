# Far LOD defaults on at phone Low

> Written by: Codex (codex-tc48), 2026-11-23

On engine `ad8d6ce20f`, the local Driftwood r9 grid reached
396,944 route triangles p95 with far LOD. The road was the
highest leg at 399,788. The matched DF5 raster was 390 × 658
at DPR 1, with a 30 fps cap and the 2.0× CPU factor.

The fenced Mac GPU p95 peaked at 3.7 ms. DF5's 3.249× ratio
estimates a 12.02 ms phone GPU p95 against the 20 ms line.
The existing blind LOD board passed. An explicit saved value
still overrides the phone Low default.

The matched control measured 708,237 pooled route triangles
p95 and an estimated peak segment GPU p95 of 11.05 ms. Frames
over 50 ms rose from three to six with the LOD enabled.

The full pinned preview from `e51e3e5b5` used the standard
headless SwiftShader spawn views at DPR 1 with the default
enabled. The largest of the three medians was 305,026 triangles.
The budget writer recorded that reading for Driftwood r9.
