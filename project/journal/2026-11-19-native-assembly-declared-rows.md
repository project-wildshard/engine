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
