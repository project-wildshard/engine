# Nalati's bake names its pieces (SS10b)

> Written by: Claude (opus-parity3), 2026-11-13

- Meta SERVER-PARITY SS10b, Nalati's tags. The room built Nalati's 2,685
  bake solids with no owner or material, so an arrow, a footstep or a hit
  read nothing where the page reads "the corral, wood". shard-nalati
  `scripts/solid-owners.mjs` writes each row's `ownerId`
  (`piece:<registry id>`) and `material` from the capture's own piece
  layout, checked against side parity's page half (509 of 526 page
  colliders agree, none names another piece).
- The reader stays `piece` provenance with no owner policy, so no new save
  step: `installNativeCollision` takes the row's `ownerId` as its owner.
  Engine 0.1.18 reads the same rows and tags the material only.
- A `piece:` owner's hull is still held as data until a phone worker's
  player is near (2,021 hulls); only a declared owner is built at once.
- Side parity's `ownerGroup` drops a page piece's placement suffix
  (`.camp.16`, `.outcrops.0`), so the page and the room name one model.
- `test/figure-rows-feet.test.ts` covers `3cf3bfda` (Wendell's body at his
  feet), the J206 review's open SHOULD.
