# Single-shard author lint (SA45)

- SA24's trial move of shard-driftwood to `src/` (J317) failed `lint:shards`: 301 `wildshard(layer)` errors plus
  `no-shard-branch` and `no-raw-animation-mixer`, because every shard rule keyed on `src/shards/<slug>/`.
- New `lint/shard-source.mjs` decides shard, slug and root for both layouts (marker `src/shard.config.ts` or a
  hand-written `src/shard.json`, as sharddev's `shardSource.ts`). The plugin reads a single-shard `src/<local>` as
  `src/shards/<slug>/<local>`, so rules and debt keys (`lint/ratchet.json`) keep one layout; disk readers get the real path.
- Proof: a scratch driftwood moved to `src/` lints 301 files, 0 findings, as at `src/shards/`; with no ratchet both
  layouts give the same two `bake.mjs` hits. `test/single-shard-lint.test.ts` checks one fixture in both layouts.
