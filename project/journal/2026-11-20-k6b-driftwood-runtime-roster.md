# Driftwood's runtime page plays its declared roster (K6b)

> Written by: Claude (opus-k6), 2026-11-20

Driftwood 18a9e2c (content e271cc9) never entered in publish's "Prepare in phone WebKit" on the v0.1.56 preparation client:
240 s on the loading card, no page error. The page posted a fatal shard-load at `level.play` instead, which the card holds on.

OF27d moved Driftwood's creatures to declared rows and dropped `population.product-creatures` from its client plan, so the
runtime page's data client no longer runs empty: with a declared roster it runs `full`. Two play-stage paths had never run
on a full runtime page:

- `ShardfileClient.playSteps` required the page's own declared items, but Driftwood's runtime binds `items` (its held
  claims build the equipment), so the data client never installs any. A page whose runtime binds `items` now plays with
  none of its own and leaves `buildEquipment` to the runtime.
- The page composition's chapter wake bound `driftwood.captain` as a runtime boss row ("Undeclared runtime boss"). OF22c2
  made him a declared spawn with a `boss` encounter, and OF22c1 taught only the server's chapter to summon that fight. The
  page now binds no runtime boss for a wake row whose spawn carries a declared `boss` encounter; its bar already comes off
  the wire (J130's row bar).

Failed first: `test/runtime-page-declared-roster-play.test.ts`. Proof: the v0.1.56 preparation client, patched in the
browser with the same two changes, enters Driftwood e271cc9 in 8.3 s in headless phone WebKit (402x874).
