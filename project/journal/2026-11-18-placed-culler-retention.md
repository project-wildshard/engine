# 2026-11-17 (Cancún) — A placed model's culler lets its placements go (MG9)

> Written by: Claude (lane mini-pinemem)

A culled `place` call keeps two closures for the model's life: its
culler's `cull` and `cullWith`. Made inside the draw function, they
held that function's whole frame, and the frame held every copy's
placement and pose: V8 keeps every variable some inner closure names,
and `drawBatched`'s copy loop, `drawInstancedSteps`' bounds and
`placeSteps`' `register` named them. On Pine Hollow that kept the
forest floor's 22,250 placements and the 918 trees alive, each with a
`Matrix4` and its `elements` array. `cullersOf` now makes the two
closures outside the draw, the instanced bounds are computed rather
than deferred, and `placeSteps` reads the count and first params before
its closures.

Pine Hollow, phone Low, the same `833c03d6` build with and without the
change, Chromium heap after two GCs at control [H]:

| Reading | Before | After |
| --- | ---: | ---: |
| JS heap used | 117.9 MB | 95.6 / 95.7 MB |
| Snapshot shallow total | 283.1 MB | 258.3 MB |
| Objects with a matrix `elements` | 67,097 | 19,451 |
| Heap numbers | 11.0 MB | 6.2 MB |
| Linked programs | 109 | 109 |

WebKit, 4 alternating cold pairs [K]: settled WebContent median 954 vs
949 MB, peak median 1,230 vs 1,248 MB, both inside the runs' spread
(JavaScriptCore's collection timing). Nothing drawn changes.
`place-culler-retention.test.ts` fails without the change.
