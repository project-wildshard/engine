# node_modules weight (meta NODE-MODULES-WEIGHT-PLAN)

- NM1: dropped binaryen, assemblyscript, @gltf-transform/core and extensions, and the direct meshoptimizer. Only six
  lift-pending tests used them, and they import `../src/sharddev/bake` and `../scripts/map-painter.mjs`, which live in
  sharddev, so they never ran here. Deleted under J186. `node_modules/.pnpm` 510.1 MB -> 302.0 MB. An existing
  checkout keeps the orphans until `pnpm prune`.
