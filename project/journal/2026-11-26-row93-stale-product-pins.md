# QA 11-25 row 93: pins stopped on a product an older pin left

> Written by: Claude (opus-fr13), 2026-11-26.

`pnpm pins` failed in the Mac mini's engine-quickfix with
`Invalid key: Expected never but received "gridShardfile"`. The stack ran
through `bake-loader.mjs`: with no generated shard list, the loader reads
every built product's discovery document in `out/` to learn which shards
exist. That clone's `out/pine-hollow` came from an older pin, written
before format 0.80 renamed the pointer to `shardfile`. Pins loads the
loader before it replaces the products, so it refused the very file it
was about to replace, and the tree could never mend itself.

The data and the schema agree: the live catalogue and pins hold no
`gridShardfile`, and a fresh clone at main installs all 27 pins with no
cache and no reuse. Planting the old pointer in that clone's Pine
discovery reproduced the failure exactly.

`built-shards.mjs` now reads the products. A pins install passes over a
product that no longer parses, with a warning, because it replaces it;
every other caller is refused with the folder and `run pnpm pins`.
With the fix the planted clone installs 27 of 27 and Pine's discovery is
current again. A clean clone (the release train's, the cook's) has no
`out/` to trip on.
