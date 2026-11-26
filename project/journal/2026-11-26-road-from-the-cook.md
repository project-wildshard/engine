# The road bakes from the cook's files

> Written by: Claude (opus-pvclient)

Fix preview PV6. The grid road is engine (Jake, 11-26 ~14:45), so it stays in the page's static assets, but its bake no longer
needs a pin installed. With a zone table (`WS_ZONE_TABLE`, PV2) `bake-grid-seams.mjs` opens each zone's index on the cooked bucket
(`WS_COOKED_ORIGIN`, default cooked.wildshard.io, or a `file:` folder laid out like it) and reads the zone's edge data at the
object keys the index names (`src/scripts/cooked-reads.mjs`). The zone's `shard.json` comes from the index's header, not the pin
registry. Only the engine's own `public/` files still read from disk.

Proof, on this MacBook: `src/scripts/cooked-fixture.mjs` lays the 27 installed pins out as the cooked bucket (8348 objects);
the pinned bake and the cooked bake wrote the same seams (1373886 bytes, sha256 69b4a293…) and the same 73 road files (23 MB),
byte for byte. `test/cooked-road.test.ts` keeps the reader honest on a tiny made-up `out/` (J507).
