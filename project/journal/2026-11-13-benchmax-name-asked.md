# NB1 reaches control again (buddy-engine)

- NINE-DRAGON-BENCHMAX NB1's `benchmax.mjs` stopped at "never reached
  control" on staging (two of two runs, 240 s). Since MP2.4 a page with
  a world asks for the Name before it joins, and a bench never answers.
  It now saves `NAME_ASKED` as the goldens and look-loop captures do.
- Staging v0.1.18, Nine, x4, 402x874 at DPR 2, cold: control 50.8 s;
  stages `finish` 44.9 s, `firstFrame` 17.1 s, `shaders` 15.8 s, `home`
  5.9 s; play 28.6 fps, 140 draws, 1.06 M triangles.
- NB2's target names a `props` stage, which the grid route's boot no
  longer has: its time sits in `home`, `shaders` and `firstFrame` now.
  The plan row says so; the target needs restating against today's
  stages before it can be met or missed.
