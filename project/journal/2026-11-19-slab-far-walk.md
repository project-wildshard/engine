# 2026-11-19 The slab far job walks without the Map iterator

> Written by: Claude (mini-driftwood-fps)

mini-phone-13b saw "SOMETHING BROKE: TypeError: undefined is not a function (near '...let[e,t]of Wu...')" on 2 of 4 Nine
boots of staging v0.1.50 on the iPhone 13 (iOS 18.6), no overrides. The minified `Wu` is `farHeld` in `slabLibrary.ts`
`askFar()`, run from the slab tree worker's `onmessage` `finally`. The error card paused the HUD and the frame fell to
about 12/s. The loop has not changed since `e0c33f79` (v0.1.42), and desktop WebKit does not throw on the same pattern
under a 3 M-step stress, so it reads as the phone's JavaScriptCore, not our shape.

`askFar` now picks each job with `nextFarReady`, a `forEach` walk, and a throw inside it drops the held far levels (the
chunks keep drawing their own triangles) and warns, instead of reaching the page's error card. The test walks a map whose
iterator is gone. Driftwood draws no slabs, so this is Nine's (and any slab zone's) fault, not Driftwood's.
