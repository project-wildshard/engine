# DF11: the dock's per-frame allocation (mini-df11)

- Chromium 3x, phone Low, 30 cap, 30 s turning dock leg, V8 sampling at 16 KiB with collected objects, source-mapped.
  Base 1.00 to 1.14 MB a frame. Road construction beside play is 0.40 to 0.48 of it; scene.updateMatrixWorld 0.09;
  the wire, render submit, parsed-page decode and the worker next.
- borderShimmer and nearColliders made garbage every step (11 and 8 KB a frame): the panel search scored four
  candidate objects per cell, the collider list was copied each step. Both now work in place, no behaviour change.
