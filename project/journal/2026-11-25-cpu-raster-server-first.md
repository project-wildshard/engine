# On a CPU rasterizer, WebKit's frames wait for the in-page server

Meta FAST-RELEASE FR-A18 (opus-nalati). Nalati's prepare on Linux took 100 to 190 s in headless WebKit against 45 s on
macOS. The boot timeline showed why: Mesa's llvmpipe draws each boot frame in 7 to 9 s on the page's main thread (first
frame 19 to 27 s, the spawn settle 27 s), and WebKit runs a worker's fetches through that thread, so the in-page server's
world boot took 77 s of reads stalled behind them.

- On a CPU rasterizer in WebKit, the boot now waits after the shaders step for the early server to boot, so its reads run
  on an idle main thread; then the frames draw. A real GPU or Chromium never waits.
- A CPU rasterizer settles the spawn view in one offscreen draw, not three: it links each program in the draw that uses it.
- The wait is a boot task (`app:cpu-raster-server-first`) and a mark with the renderer name, so the next Linux rehearsal
  shows whether it ran and what it cost.
