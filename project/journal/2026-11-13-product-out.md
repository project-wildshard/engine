# Product out of engine (SHARD-AUTHORING SA25)

> Written by: Claude (opus-sa3), 2026-11-13

- J317 retires *product* everywhere. One codemod (kept at
  `~/.cache/wildshard/plan-artifacts/sa25/sa25.mjs`, re-runnable on a fresh
  base) renames every compound identifier and module file name that said
  it: engine calls a built shard file folder a *folder* (`ShardProduct` is
  `ShardFolder`, `loadHeadlessProduct` is `loadHeadlessFolder`,
  `game/shardfile/product` is `game/shardfile/folder`), and follows
  shard-format v0.5.0 (SA23) for its renamed subpaths and names.
- Engine keeps "shardfile" for the raw upload and "folder" for the built
  one, because both exist side by side (`preflightShardfile` and
  `preflightFolder`, `readGridShardfileFar` and `readGridFolderFar`).
- What stays: bare `product`/`products` locals, data keys (riggedHulls
  `productFiles`, worldScene `product`), the director schema id, CI
  artifact names (`test-products.tar`) and test file names: the CI21
  lift-pending policy forbids renaming a listed test, and a test name is
  no export.
- Consumers: sharddev and the shard repos import nine renamed engine
  subpaths; they take the map with their next engine pin (`moves.json`
  beside the codemod).
