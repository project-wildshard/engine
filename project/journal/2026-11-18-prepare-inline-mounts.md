# wildshard prepare: the inline candidate's mounts join the byte table (mini-pinemem5, MEMORY-GATES MG9)

> Written by: Claude

`wildshard prepare` timed out at 240 s on Pine, locally and in Pine's publish run 44049111314. Two causes, found by
opening the preparation preview in phone WebKit and reading the page:

1. The sdk fetches the preparation client at its engine pin (sdk 0.2.13: engine 0.1.18; 0.1.36's client failed the
   same way). That client's shard-format refuses a newer product's index (`Invalid key: Expected never but received
   "epoch"`). A product needs a client whose format reads it (`WILDSHARD_PREPARATION_CLIENT`); the pin moves with MG8.
2. With a client that reads it, level.data refused: `trees declares /assets/gpu/models/pine-hollow-trees/cards-albedo.phone-1210f7ed.ktx2
   but public/assets has no such file`. The byte table is the build's, made from the pinned revisions; 38 of the
   candidate's 414 cook mounts (S12d's engine-cooked phone ASTC files, the programs, discovery) were not in it.

Fix: an inline-owner page (DEVSERVER or PREPARATION_ONLY with `ws-shardfile`) reads its candidate's `cook.json` and adds
its mounts' bytes to the asset tables before admission (`assetTables.ts` `adoptInlineMounts`). Prepare then finishes
Pine in 8.6 s with 110 programs. Test: `test/inline-mounts.test.ts`.
