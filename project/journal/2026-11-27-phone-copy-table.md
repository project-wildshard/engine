# A phone reads the copy the cooked table names (SF7c)

Nine Dragon on SDK 0.9.1, prepared and cooked, entered the 402x874 phone
with 12 misses: `paint/*.jpg`, each a 404 then an abort. The product's
lent texture layers (`worldSceneTextures.ts`) read each layer through
`phoneUrl`, which swaps in `<name>.phone.webp` only when the page's own
byte table lists it. The preparation ran on the staging page, which still
holds the zone's files in `public/`, so it read `concrete.phone.webp` and
the prepared phone set carries that copy, not the jpg. The cook entry's
page holds no copy of the zone (SF10's end state), so the same phone
asked `concrete.jpg`, which the fence left out.

The earlier Nine proof (SF7j) cooked an unprepared shardfile, whose phone
set is the whole shard, so the jpg was there and nothing missed.

`phoneUrl` now also counts a copy the tier's registered KTX2 table keys:
the cooked discovery document names every shard file there, hand-made
phone copies among them. Pages that still hold zone files see no change.
Proof: `test/phone-copy-table.test.ts`, and Nine's cook entry on both
tiers with missing 0.
