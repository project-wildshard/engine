# Nine's phone memory: where the loading peak goes (mini-ninemem, MEMORY-GATES MG10, 2026-11-17)

Probe: `scripts/boot-memory-peak.mjs` (mini-memcal's renderer x2.0, Low). Nine, local builds, Mac mini. One run's peak
moves 850-1030 MB of renderer between runs of one build, so a cut is judged on 3-4 alternating runs.

- Renderer at firstFrame ~720 MB (detailed memory-infra dump): array buffers ~290 (a GC'd heap snapshot holds 144 live),
  V8 main heap ~200, malloc ~150, the rest Blink, canvas, shared memory. The title page alone is ~270 MB.
- GLB views read in place (`rigParser.ts` `splitGlb`): three copied each GLB's whole BIN chunk and then each view out of
  the copy; 61 MB of main-thread copies under the card are gone (278 to 218 MB). Peak mean 950 to 939 MB, inside noise.
- Ruled out by A/B: the phone slab facing tree and far levels (NB8, NB23 b) cost no measurable peak.
- Chromium's GPU-process jump at the reveal (ANGLE Metal, +1.3-1.9 GB) disappears with WEBGL_multi_draw hidden (367 MB);
  the slab multi-draw is what ANGLE Metal holds memory for. Not the phone's meter (mini-memcal), noted for the record.
