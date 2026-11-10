# CI21 port: graph, fixed-draw and route lift tests back in the suite

J232 batch two, from the project-wildshard-meta CI21 port map. Eighteen files
return to engine's blocking suite and two Sky files leave for their shard.

- Thirteen graph tests mixed engine compile law with SDK authoring. Engine
  can't import sharddev (J65), so each keeps its compile/runtime half here
  and its authoring assertion moved unchanged to sharddev
  `test/graph-author-ops.test.ts` (3dae05c, 1b156fd). Where engine needs the
  authored IR (day-toon, optional-attribute) it compiles a literal, and
  sharddev asserts `graph()` still emits that exact literal.
- `fixed-draws` and `pine-posed-tier-loading` ran Driftwood's and Pine's
  generators for one template or row each. They now read byte copies of the
  shipped files from the pinned products (gull and reef-fish GLBs, Pine's
  `look/wildlife-draw.json`); every case is unchanged.
- `specimen-explorer` builds its named rows with engine's own
  `hashImmutableBytes` and `fixtureProductFile` instead of `nameBlob`.
- `shipped-graph-cost` enumerated `src/shards`, which engine no longer has;
  it now covers every installed pinned product (the full pin hash set), read
  by folder and reported by slug. Ring 2: it needs all 28 products.
- `physics-shards-headless` is unchanged. Nine's 19 routes were skipped
  because the Nine session imported the moved `nine-headless` fixture; engine
  owns it again and reads Nine's walk bounds from the pinned product's
  `ui/level` manifest section. All 55 routes pass. Ring 2, like
  `physics-headless`.
- `sky-vane-scene` and `sky-mill-scene` prove Sky's own rows; they moved to
  shard-sky-reach (23ba938).

J206 Codex reviews: graph GO (one SHOULD done in sharddev), fixtures GO;
the census review's MUST (Ring 2 placement) and SHOULDs (hash-set match,
folder versus slug) are done.
