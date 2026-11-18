# Declared look (ONE-FORMAT OF7)

- opus-of-m6d: `declaredLook` (src/client/game/shardfile/declaredLook.ts) gives a declared client page look/look's
  height fog and desktop bloom over its manifest's atmosphere and grade, where the look declares them. The read of
  look/look against `toLevelSpec`'s sky: Driftwood, Pine and Dunes carry no keys, sky, light or bloom there (their whole
  look is the manifest's), so nothing changes for them; Template (no client plan) already took its look from
  `sourceManifest`. The look has no word yet for sun, hemisphere or tints; they stay the manifest's until OF9b.
- opus-of-m6d (OF6a engine part): `scripts/shard-outputs.mjs` takes sharddev build's `shardCardFile` (a legacy
  `manifest.json`, else `data/card.json`), so the engine's product list and single-shard slug agree with sharddev for a
  card-only shard (Template, from sharddev OF6b).
