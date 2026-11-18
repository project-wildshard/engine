# Keep Driftwood's phone templates on their grid

> Written by: Codex
>
> **State:** measured 2026-11-18. ENGINE-MEMORY EM28.

The phone scene reader holds admitted unsegmented templates in
normalized grid storage. Model-space consumers receive their original
geometry on copy. Compatible private static leaves can bind the grid
after tiling even when the producer supplies no sphere. Existing
authored bounds, published objects, colliders and incompatible
materials keep their established behavior.

On the same production Driftwood revision 2, six alternating cold
minimal WebKit pairs under the mini's shared lock read 43.70 to
42.56 MB of control WebGL buffers [L]. The 1.14 MB drop repeated in
each pair. A matched Chromium Metal heap snapshot read 67.32 to
64.36 MB of whole-heap geometry backing [H]. The root position/index
subset fell 23.89 to 22.50 MB. The plan target is 60 MB whole-heap.

The paired median load peak WebContent [K] was down 1.14 MB, with
individual differences from -48.73 to +46.12 MB. The six-run
playing/loading upper predictions moved 1016.97 to 1027.49 MB and
1369.77 to 1374.77 MB. The direct geometry readings establish the cut.
The process batches leave the native footprint direction unresolved.

The nine fixed Phone Low views kept the same draw and triangle
counts. The board was sent before the push, and the raw runs and
images are under the mini's plan-artifacts/engine-memory/
em28-em38-2026-11-18/driftwood. The geometry and scene suites passed
53 tests. Engine and game typechecks passed.
