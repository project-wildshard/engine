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
- STR19, the placed culler: Nine's culler owned 6.1 MB/s of the walk's 15.2 [S] (5a8d0e52, one run). The big one was
  `Chooser.level` (4.8 MB/s): `View.sees` tested the casting cascades with `.some` and an arrow, a closure per copy tested.
  Then the casters spread into an argument list per choice, `forEach` loops in the set and weld cullers, the residency
  test's closure per call, and two boxed numbers per copy where a call that V8 does not inline took the distance and
  radius (`levelAt` is written out in `level`; `Sinks.put` reads the distance from a field). Last, every culler re-derived
  the camera's inverse, view-projection and six planes itself on every moved frame: `viewAt` derives them once a pass per
  camera pose (plain and widened) and each view copies the frustum. One walk on the finished build: culler 0.08 MB/s.
- The culler meter counts every function of cull.ts plus place.ts's frame pass and the scene's residency test; placing
  a streamed tile's copies (place.ts's builders, `posed`) is loading, not the frame, and is left out of it.
- STR20, the next frame allocators from STR18's list (Nine, one walk each on the finished build; base 15.2 MB/s):
  the lent-param writers (0.67: a miss after any lend change made seven arrays and closures per id; now one list),
  the channel programs (0.57: the merged lane's observation object and destructuring `for ... of` per lane; the post
  look's own observation, empty values bag and writer object per frame), the grapple's state rows (0.39: two strings per
  read and a decoded row object; `stateField` now finds the handle by declared name and decodes the one `value` column),
  the tile driver's step (0.36: a position object, two layer arrays, a closure per tile scanned and a key string per tile
  per frame), the slab draw hook (0.27: a rest array and a `Reflect.apply` list per draw on the context), and the cheap
  part of the worker's present (the page population filter, the contact splice, the entity map copy) and the other
  players' entity walk (`forEach` with one visitor, no entry pairs).
- What is left on Nine (~7 MB/s, one walk) is mostly three's draw path and boxed numbers: `getParameters` on program
  checks, uniform setters reading doubles through megamorphic loads, the render list's sort, channel readers returning
  numbers through calls V8 does not inline. Under the 2 MB/s line needs those, which is past this row's five.
