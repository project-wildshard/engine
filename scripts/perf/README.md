# Draw census (EP1)

Use an existing pinned `serve-build.sh --rev <sha>` preview and its private
`dist` (which retains hidden maps). Run through the browser lane:

```sh
scripts/browser-lane.sh node scripts/perf/draw-census.mjs \
  --url=http://127.0.0.1:4400/ \
  --dist=tmp/serve/<build>/dist \
  --out=tmp/draw-census/current
```

One command opens four fresh, sequential Chromium contexts: Nine P4 and Pine
Q4, LEGACY and SHARDFILE. It uses iPhone 16 Pro, phone tier, 2x scale, 4x CPU,
seed 357 and dither off. Both entry buttons must exist; a missing mode refuses.
The served/private build IDs must match. Actors, health and visibility remain
live. The requested and actual held poses are retained; this is a diagnostic
census, not a pixel-parity or physical-phone performance result.

Each pose settles for eight seconds, then records three separate windows
(default 60 completed frames, `--frames=10..180`):

1. **Native baseline:** `Game.renderMs` / `workMs` and `lastFrame` for the
   same completed frame, before census hooks or the CPU profiler. Render CPU
   includes sky, culling and the complete composer; update time is separate.
   Microseconds per draw are calculated per frame before taking a percentile.
   A zero-draw denominator is null, never zero.
2. **Attribution:** actual GL submissions by composer pass, shadow / render
   target / screen and full scene owner chain. Hooks add overhead, so this
   window gets no timing acceptance. All GL counts must match native calls.
   A `WEBGL_multi_draw` invocation counts once, as three's `info.update` does;
   its sub-draw count is retained separately in each raw row. `useProgram`
   counts actual invocations, not inferred material switches; program IDs
   identify actual `WebGLProgram` objects. Unattributed draws remain explicit.
3. **Sampled CPU:** CDP at 200 us with the hooks removed, mapped through the
   matching private maps. Draw-wrapper overhead excludes stacks inside the
   stock three draw; nested wrappers count once. Property hooks are a
   separate inclusive bucket. Missing sampled categories are null, not a
   fabricated zero. Sampling and hooks never supply the native baseline.

The command prints the comparison table and top pass/owners. `census.json`
retains every native and attributed frame (including exact owner rows),
`table.md` retains the report, and four `.cpuprofile` files permit reanalysis.
Partial results persist on failure. Every hook and context closes on either
success or failure; no Debug row, URL switch, runtime import or shipping
instrumentation is installed. No `gl.finish`, readback or per-draw query is
used. EP10 owns acceptance policy separately.
