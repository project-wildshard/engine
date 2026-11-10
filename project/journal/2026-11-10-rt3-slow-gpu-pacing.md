# RT3: pace frames on a slow GPU

> Written by: Claude

The release train's hosted Chromium (headless, SwiftShader, phone profile at DPR 2) ran the long grid road 120-300 m
short every run while WebKit passed. Native capture of run 42783939994: 36 main frames held the page 18.1 s of 20 s on
0.45 s of CPU (max 902 ms), the worker sent ticks at 59.7 TPS, and its snapshots reached the page 731 ms late (median).
The page was waiting on the GPU, not computing: with software compositing, every frame that shows a freshly drawn
WebGL canvas reads it back on the main thread behind all of the frame's GPU work (LS11's `coverCanvas` finding).

Reproduced locally by putting only the GPU process at background QoS (`taskpolicy -b`, E-cores) on the same launch:
390 ms main frames (median), 2.4 drawn frames a second, snapshots 498 ms late, the long road 282 m in its first 60 s
(4.7 m/s; unthrottled SwiftShader does 7.2 m/s). Frame cost scaled with the drawing buffer's pixels: 390 ms at pixel
ratio 2, 96 ms at 1, 37 ms at 0.5.

`slowGpuPacing.ts`, only on a GPU the shaders step measured slow (finish.ts `slowGpu`), measures each drawn frame's
whole main-thread cost (rAF start to the first task after it, so the read-back counts) and:

- lowers the render scale when a 5-frame median is over 50 ms (by sqrt(target / median), floor 0.5), and raises it
  back toward the tier's after four windows under 32 ms (a 1.25x step costs at most 1.56x);
- holds the next frame back after a hitch over 100 ms by its excess (at most 1 s), so the messages it held up drain.

Spacing every frame was tried first (frames at most 2/3 of the main thread): snapshots arrived 6 ms late but Chromium
then delivered animation frames at 4-9 a second; spacing only hitches kept 17.5 drawn frames a second. A raise
threshold right at the 1.25x step made the scale hunt between 0.5 and 0.875 on noisy costs; four calm windows fixed it.
No game check, clock, command budget, prediction ring or limit changed. Captures draw unpaced at the tier's own scale.
