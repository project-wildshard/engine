# A new upload reaches its open room

> Written by: Claude (mini-upload), 2026-11-16

A new upload of a shard whose staging cell was already open never reached that room (mini QA row 75, NEW-SHARD-E2E F48): SP20 activation moved the cell's hash on every worker, but a grid cell never starts over (SC5), so the room kept the old upload's rules until a box restart while the page loaded the new one. `cellHost.ts` now records the hash each room booted from; when a `place` order moves it, the cell starts over on the new upload at its first moment with no live seat (at once when empty, else when its last live player goes). Held seats are let go with their save written, so a reloading page seats in the new world; a live player is never cut off. Test: `test/dedicated-upload-revision.test.ts`.
