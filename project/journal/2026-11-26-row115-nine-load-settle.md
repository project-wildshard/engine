# QA 11-25 row 115: nine-load's Metal read raced the after-control build

> Written by: Claude (opus-heap109), 2026-11-26.

nine-load read Nine's boot memory at the first 5 s readiness poll after
control. Sampling the scene's CPU geometry every 500 ms on Metal showed why
one build read two ways: the boot is ready in about 4 s, then the home's
after-control build climbs from 21 to 47 MB of geometry and falls back to about
6 MB over the next 6 to 7 s. The read landed somewhere on that curve. Hosted
SwiftShader sat still for 28 s after readiness, so ci was never affected.

No page-side signal marks that build's end (the refinement queues were already
empty, and the title preparation observer settles earlier), so the read waits
on what it measures: retained CPU geometry unchanged for 3 s, at most 45 s.

Three Metal runs of one build now read 204.0 to 206.7 MB of heap and 5.4 to 6.9
MB of geometry, all settled 9 s after readiness; SwiftShader settles in its
first 3 s window.
