# QA 11-25 row 86 (c): the grid's fights, room and checks

> Written by: Claude (opus-fr13), 2026-11-26.

On the grid the page's level is the platform's, not the zone's, and the
entered zone's creatures live in the cell's own manager. Several worker
client checks the one-shard page passed failed there for that reason.

- **The bear's blow.** Driftwood's declared hunts ran with an empty fight
  (no telegraph, so the charge made contact with no wind-up) and its charge
  carried no `feel.blow`. `installLayerHunts` now takes the shard's
  authored fight, and the charge's hit is a felt blow
  (`test/driftwood-bear-blow.test.ts`).
- **The wind-up warning, the kill feed, the cries.** The cell's manager now
  hands `onKill`, `onSound` and `onWindup` on to the page's
  (`cellCreatures.ts`), and Combat follows the entered cell's creatures for
  its damage numbers. The page reads the entered zone's fight
  (`enteredFight`) for the warning, the hit arc and the kill feed. Quest
  hints read the creatures the player meets (`fighting`), so a wind-up
  teaches the dodge.
- **The practice room.** On the grid the player walks in the cell's or the
  road's physics; the room was built only into the page's, so the player
  fell through it. `RoomStands` opens the room in the physics the player
  walks in, built once there (`test/practice-room-stands.test.ts`).
- **Checks that read the one-shard page.** The sky check now reads the
  app's day clock (the entered zone's sky). Driftwood holds midday
  (shard-driftwood db75bf3), so its day is followed but never moves. Nine's
  fall check now expects the grid's rule: a fall below the floor is one
  death, and the player comes back on the stack whole.
- **Sky Reach's 404 and 405.** The build's cook writes the phone tier's
  own files (`*.t512-*.glb`) beside each product, then the product copy
  deleted the whole `shardfiles/` tree and laid the served discovery,
  which names them, back over it. A local build 404'd on each, and the
  page's error report then hit the preview's missing `/api/errors` (405).
  `copyOutputFolders` now keeps the files a served discovery names
  (`test/output-products.test.ts`).
