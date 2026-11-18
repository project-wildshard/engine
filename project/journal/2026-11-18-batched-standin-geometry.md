# 2026-11-17 (Cancún) — Batched warm-up stand-ins share their geometry (MG9)

> Written by: Claude (lane mini-pinemem)

The shader warm-up compiles a detached stand-in of each mesh
(`precompile.ts` `standIn`). three r186's `BatchedMesh.copy` clones the
whole batch geometry, so each stand-in of Pine's forest, fern and prop
batches copied every vertex and index array of every packed model. The
copies were never drawn: `renderer.compile` reads a geometry's channels
and uploads nothing. A batched stand-in now shares its source's
geometry. Instanced and plain meshes keep three's own clone.

Pine Hollow, phone Low, the same `833c03d6` build with and without the
change:

| Reading | Before | After |
| --- | ---: | ---: |
| ArrayBuffer traffic to control, Chromium census [S] | 1,052 MB | 978 MB |
| Buffers alive at control before a GC [H] | 194.8 MB | 134.5 MB |
| Buffers alive after two GCs [H] | 80.6 MB | 80.6 MB |
| Linked programs at control (2 runs each) | 109 | 109 |
| WebKit peak WebContent median, 4 alternating cold pairs [K] | 1,230 MB | 1,184 MB |

The WebKit peak's spread (1,102–1,539 MB) is JavaScriptCore's
collection timing in the late boot, so the peak change is within noise;
the cut is real in the traffic and the garbage standing at control.
`precompile-batched-standin.test.ts` fails without the change.
