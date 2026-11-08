# node_modules weight (meta NODE-MODULES-WEIGHT-PLAN)

- NM1: dropped binaryen 132, @gltf-transform/core and extensions, and the direct meshoptimizer. Only six lift-pending
  tests used them, and they import `../src/sharddev/bake` and `../scripts/map-painter.mjs`, which live in sharddev, so
  they never ran here. Deleted under J186. `assemblyscript` stays: `scripts/shard-platform.mjs` loads its Parser API
  through a joined specifier (`['assembly','script'].join('')`) that a grep for the name misses, and the ratchet census
  needs it (test/ratchet-paths went red without it). `node_modules/.pnpm` 510.1 MB -> 403.6 MB. An existing checkout
  keeps the orphans until `pnpm prune`.
