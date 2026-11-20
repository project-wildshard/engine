# DF11: the dock's per-frame allocation (mini-df11)

- Chromium 3x, phone Low, 30 cap, 30 s turning dock leg, V8 sampling at 16 KiB with collected objects, source-mapped.
  Base 1.00 to 1.14 MB a frame. Road construction beside play is 0.40 to 0.48 of it; scene.updateMatrixWorld 0.09;
  the wire, render submit, parsed-page decode and the worker next.
- borderShimmer and nearColliders made garbage every step (11 and 8 KB a frame): the panel search scored four
  candidate objects per cell, the collider list was copied each step. Both now work in place, no behaviour change.
- Road build: the bin and clip loops index plain attributes' arrays (checked after every pause, three's getters
  otherwise, so the anchored live-read, spied-getter and golden-hash tests hold); the LOD clusterer's Map of boxed
  double keys is a typed open-addressed table (LodFirsts); a solid part's bounding sphere is read from its Float32
  array (bit-equal to three's); streetlight copies go straight into typed arrays. Candidate A (most of this) took
  the dock from 1.14/1.03 to 0.85/0.86 MB a frame, road build 483 to 262 KB.
- Not yet cut: scene.updateMatrixWorld allocates about 25 KB a call, all under the `creature-warm` group (348
  nodes); a fresh 750-node tree in node allocates nothing, so something on those nodes (an accessor or a patched
  method) boxes. The next owner should read that group's nodes first.
