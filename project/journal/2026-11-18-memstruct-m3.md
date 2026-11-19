# 2026-11-18: zero per-frame allocation (meta MEMORY-STRUCTURE M3, STR18 to STR22, lane mini-memstruct-m3)

- STR18, the walk meter: `measure.mjs --online --walk[=60]`. After control each run walks a fixed route (Nine: its street
  loop out to the stack and back, ~250 m; every other zone turns on the spot at 0.5 rad/s, moving forward). WebKit carries
  [K]: WebContent and GPU peak in the `walk` segment above the settled reading (the boot checkpoints read only samples
  before the walk mark, so EM11 is untouched). A second, Chromium boot of the same build walks the same route under V8's
  sampling heap profiler (objects collected by both GCs kept) for [S]: bytes allocated per second, owners (the innermost
  `src/` frame, through the build's hidden source maps) and the top stacks. `--profiles=<dir>` keeps the raw profiles.
- The route driver runs in the page and allocates nothing itself (scalars, one `requestAnimationFrame` step, the held
  forward key re-set once a second): the first driver allocated ~0.6 MB/s of its own and those readings were discarded.
- The sampler charges a function's start line, and inlined callees to their caller: `--js-flags=--no-turbo-inlining`
  splits them but boxes every double a non-inlined call returns (Nine read 29 MB/s that way), so it names sites only.
