# 2026-11-18: a real GPU keeps the wide first frame (SB47)

- opus-sb49: headless WebKit iPhone at 4x CPU and 30 Hz rAF read
  Driftwood's First frame as 1.5 s or 6.7 s on the same staging build.
  The shaders step sat on LS8's 15 ms a program bar (916 ms for 58
  programs: wide; 963 ms: narrow), and a narrowed first frame draws 246
  one-drawable slices, a painted frame each. Jake's Low Power iPhone
  (11.4 s shaders step, Metal) was always narrow: First frame 8.0 s,
  246 frames at 30 Hz.
- `slowShaderGpu` now needs a software rasterizer by renderer name
  (RT3's `softwareRasterizer`), as the in-play pacing already did. A
  real GPU keeps the wide first frame, which still narrows itself after
  a slice over 400 ms (FIRST_DRAW_NARROW), and its canvas is no longer
  covered during load.
