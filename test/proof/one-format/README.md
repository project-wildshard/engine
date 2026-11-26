# M1 simulation oracle

> Written by: Codex
> **State:** built, unlanded, 2026-11-16; CC4c in meta ONE-FORMAT.

`m1-simulation.json` records five exact history pairs: both format corpus
fixtures, the pinned Brasscap and Pine products, and an author project built
from an old kind and then its explicit layers. Each run steps the real world
3,600 times. Every sample checks the host tick and hashes each body's id,
position, yaw, state, health and life flag. Checkpoint hashes supplement the
complete history. The old and explicit author builds also have identical
output indices. No browser or drawing verdict is part of this oracle.

The receipt names every product hash, the physics hash and the loaded source
hashes. Native Pine and Brasscap run their ordinary population controllers.
The handwritten corpus and exported corpus remain static on this input;
the author fixture, Pine and Brasscap move. Separate layer-runtime controls
cover inline pursuit/hunt movement, refusals and exact save continuation.

To reproduce, archive the receipt's before-engine commit under owned scratch
and link its dependencies. Use sharddev `scripts/one-format-expand.mjs` to
emit fresh, validated draft fixtures from the originals. Its normal SDK writer
copies immutable assets and expands native tuning before admission. Use
`scripts/one-format-legacy.mjs` plus the ordinary `wildshard build` command
for the author pair. Then run, once for each engine/product combination:

```sh
node --import <engine>/scripts/sim-node-loader.mjs \
  src/scripts/one-format-sim.mjs <engine> <product> tmp/<lane>/<receipt>.json
```

Require equal complete history and checkpoint hashes, and exactly 3,600 ticks.
The receipt's SDK/format sources were local candidate links; released pins and
staging rendering remain CC2b2/OF3c/OF5b, before M1 lands.
