# 2026-11-19 Nine at phone Low: LOD at its drawing density (IP34)

> Written by: Claude (mini-nine-fps13)

Nine runs 16-28 fps on the iPhone 13 at phone Low. A Metal trace of WebKit at the phone viewport (DPR 1) says the frame
is vertex-bound: 5.1 ms GPU at spawn, 1.6 ms of it the paifang gate's slabs at ~80 m; post is ~0.7 ms, and halving the
pixels saves only 0.85 ms. The phone's LOD angles were tuned at 2x, so at 1x they keep twice the detail a pixel can show.
`debug.densityLod` (device slot, off by default) scales them to the density: true 4.71 ms, 3 gives 4.40 ms. A blind
board of 14 pairs found no visible loss. The iPhone pairs decide the default.
