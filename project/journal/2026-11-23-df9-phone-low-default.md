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
