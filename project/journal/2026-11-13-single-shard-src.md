# The shard build scripts read a single-shard src/

SHARD-AUTHORING SA42, the engine half (buddy-repos paused it on
engine, meta `f4b9040`). sharddev's verbs already accept a single-shard
repo whose source is `src/` (SA16, J317), but `build-shards` imports
engine scripts that only ever joined `src/shards/<folder>`:
`shard-outputs.mjs`, `built-product.mjs` and `map-hash.mjs`.

`shard-outputs.mjs` now owns the layout, by sharddev's own rule:
`src/shard.config.ts`, or a hand-written `src/shard.json` with no
config, is a single-shard repo whose one folder is named by the
hand-written index's identity slug, else its manifest's slug, else the
repo folder. `shardSourceDir(root, folder)` returns `src/` for that
folder and `src/shards/<folder>` otherwise; `shardSourceFolders` lists
both. The folder list, `outputs.json` and `manifest.json` reads,
`readBuiltShardfile`'s source check and project path, and `mapShards`
all go through it. A bad `outputs.json` names its real path.

Input receipts needed nothing: they hash tree paths, so a single-shard
repo's `F src/...` lines follow on their own.

Next is sharddev's half (row 268 step 2): pin this engine and have
`build-shardfiles.mjs` take its folder list from `manifestFolders`
or `shardSourceFolders` instead of its own `src/shards` read.
`test/shard-source-layout.test.ts` covers both layouts, the slug
fallbacks and a tree with no shard source.
