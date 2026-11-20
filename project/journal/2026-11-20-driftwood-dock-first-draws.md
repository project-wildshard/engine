# The Driftwood dock's first draws

> Written by: Claude (lane mini-driftwood13e), 2026-11-20. Meta IPHONE13-DRIFTWOOD DW3, DRIFTWOOD-FPS DF8.

The dock leg stands still, so its frames over 50 ms on the iPhone 13 are things arriving, not things turning into view.
`route-bench --frames` logs every long frame with what the GL context and the scene did in it. Three causes showed up:

- **The outer road deck's first draw** (~14 s after control): one 246 to 313 ms frame. A phone profile put it in the
  vertex pack, not the GPU: `packFormat` scanned each Float32 channel with a `for…of` iterator and `encode` wrote every
  element through a closure and a DataView into one of four typed-array kinds. An indexed scan and one Int32 loop with a
  native conversion pack the same bytes; first-draw packing went from 218 ms a boot (worst channel 73 ms) to 47 ms
  (worst 11 ms), and the deck frame to 78 to 118 ms.
- **The outer ring's strip colliders** (seconds 5 to 9): about 80 Rapier trimeshes of ~2,000 triangles, 0.7 ms each in
  Node, 3 to 28 ms in desktop Safari, more on the phone, and none can be sliced.
- **Near placeholders and far proxies** being prepared beside them.

**The strip colliders now wait for the player** (`nearColliders.ts`, device slot `debug.outerCollidersNear`). A strip's
collider is built once the feet come within 120 m (plus four seconds of travel) of its bounds; a distant entry or a
recovery still gets the whole ring at once. Three alternating cooled phone pairs at the dock: 9, 18 and 8 frames over
50 ms with it on, 30, 43 and 11 off, and no outer collider build over 4 ms. Unset, it is on at phone Low.

## The cumulus at phone Low (DF9, later the same night)

The sky's cumulus is never frustum culled, so Driftwood's 191 puffs at icosahedron detail 2 were 34k triangles in every
frame at every yaw. At phone Low they are now drawn from detail 1 (15k). The puffs are lit by their smooth centre normal,
so the light bands stay round; a blind look board at five poses (with shard-driftwood ef12da8's sea cut, Opus judge)
found the same look at all five.
