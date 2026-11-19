# A native assembly stands declared creature rows (ONE-FORMAT OF22b0)

> Written by: Claude (opus-of22)

- Driftwood runs as a native assembly, which had no declared-creature path (only a runtime plan did, OF19b0). The
  assembly's level now stands `shard.creatures.spawns` and installs `installRuntimeCreatures` after its own hosts.
- Ownership: decision rows binding any body that is not a declared spawn stay the assembly's (its `decisions` host
  lends them); a row binding both refuses. A body both claim refuses in `SimHost.spawn` ("already stands: one body,
  one owner"), since the assembly's hosts stand their bodies at install.
- No shipped native product declares spawns yet, so nothing changes until OF22b moves Driftwood's creatures.
- Gotcha: engine-quickfix's `out/` can be a Ring 1 install (`out/.slices/`), which carries only server-read files, so
  the test admits `serverReadsFile` files only.

## OF22a1: the day and the sea from sections

- A native assembly whose plan names no `day.*` host now runs the look's toon sky clock (`look/toon` `sky.day` over
  `sky.cycleSeconds`, as the page's toon sky does), else the first `world/days` row; with no `water.*` host it takes
  the declared sea row's water (swell when `waves`). Driftwood can then drop `day.toon` and `water.sea` (OF22a2).
- `day.toon` to a `world/days` row is not faithful: a days row is an hour clock with no night or dusk curves, and
  Driftwood's quest chapter reads `dayClock.night`. The look section is already declared data, so the clock reads it.
- Proof: shipped Driftwood beside the same product with both hosts cut matches tick for tick (clock, night, float in
  the sea, whole digest) and restores exactly.
