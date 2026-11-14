# 2026-11-13: the app build cooks the phone tier (S12d)

Meta SHARD-SIZE S12d, steps 1 and 2. The box's cook made the phone's
6x6 files since `21959b0912`, but the app build still listed every
pinned shard with its product's own KTX2 table, so a phone of a local,
CI or ring build read the untiered table.

- `writeSpawnManifests` takes `BuildHalf.tiers` (the app build passes
  `defaultCookTiers` with an encode cache under
  `~/.cache/wildshard/gen/spawn-parts-br/astc6-1`, which CI's existing
  spawn-parts cache keeps). It writes the tiered `discovery.json` to
  `out/.app/discovery/<shard>/`, which `copyOutputProducts` lays over
  the product's and the catalogue hashes, and writes each phone file
  loose under its URL. A preparation-only build takes no tiers, so a
  recorded fence keeps the product's own URLs.
- `phoneTier` encodes a kept row (horizon, `#layer` twin) 6x6 at its
  own size from its own file, as S4's hand sets had it, so the shards
  can drop those too.
- The phone overlay (Sky's inventory, fence identities) and the
  client's raw-ASTC veto read the cook's `.t<size>-<hash8>` files as
  well as `/astc6/`.
- Full pin set only: a recording a shard cook packed alone and the app
  build listed again under another URL made two parts with one name.
  Cooked parts now seed the twin check (`spawn-parts.test.ts`).

Gate on all 27 pins: driftwood-isle 21.08 MB, far-reach 25.98 MB
(latched), Pine 41.09, Nalati 43.28, every product within its ceiling.
A cold build encodes for about 7 minutes; warm, 11 s.

Review follow-ups. The served discovery documents now sit inside the
build's own output (`<out>/.discovery/`), which `copyOutputProducts`
lays over each product's and then removes, so no build reads another's.
The pre-pass keeps only each served document and a way to reopen the
product, not 27 open shardfiles. A cache hit touches its 6x6 file and
ci.yml drops encodes no build read for three hours; the hover-contract
and census builds restore the spawn-part cache before `build:game`, so
a CI build pays the cold encode once.
