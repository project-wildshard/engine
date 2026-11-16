# Product out of engine, redone on today's main (SA25, opus-ss16q, 2026-11-16)

- opus-sa3's codemod (`plan/sa-rest`, 2026-11-13) rerun on main 948 commits later: 290 compound names, 52 files moved,
  689 edited, 11 more by file name. Package exports carry no `product` any more.
- Kept as before (opus-sa3's review fix `4a3eda5e`): lift-pending tests, parity baselines, CI fixtures and the lift
  disposition keep their bytes; the director schema key stays `directorProduct.DirectorProduct` (the wire id); the map
  stamp stays `data/productMap.json`; prefetch counts shard files (`3 / 25 cells checked`); the Nalati debt row keeps
  its path. New this time: three name collisions, all harmless (cookJob's alias became a plain import; `productOf` and
  `folderOf` are local functions in different files), and `nine-walk-verbs.test.ts` (lift-pending, importing the moved
  `productSession` fixture) joins its siblings in test/tsconfig's exclude list.
- Consumers: sharddev and every shard repo import `@wildshard/engine/host/headlessProduct`, sharddev also seven more
  renamed subpaths. They follow on their next engine pin bump (SA25b, the sdk codemod for shard repos).
