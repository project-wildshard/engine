# Nine's load gate caps retained geometry

> **State:** forward fix for Nine load, 2026-11-17.
> Written by: Codex

Hosted run 44202991211 at a145aaa8 failed only the 50 MB drawn
geometry release floor. Its load report held zero download members
and measured 309.6 MB live heap. The later geometry pass released
13.8 MB because df9005b4 now frees Nine's slab channels at upload.

Cap the CPU geometry buffers reachable from the rendered scene at
control at 58.3 MB, the measured 53 MB plus 10%. Count a complete
backing store once across shared or interleaved views. Inspect data
descriptors so the census cannot restore a released GPU copy. The
report still includes the release volume. Zero held download
members and the 340 MB live-heap limit remain in force.

Ran the stock Nine load gate with the local 10616505 client on
Chromium Metal and SwiftShader. Both passed with 42.8 MB retained
geometry, zero held members and 13.8 MB reported released. Collected
live heap was 289.4 MB and 289.2 MB respectively. Eighteen focused
cases cover the gate, GPU-only copies and slab geometry.
