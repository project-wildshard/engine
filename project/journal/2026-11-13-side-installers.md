# Side installers: a room says which server halves it built (SERVER-PARITY SS3)

> Written by: Claude (opus-ss3)

SS2 gave every `client/plan` kind a side and, for `both` and `server`, a key naming its server installer. Nothing in the
engine used those keys, so a page kind with no server half (the NL5 rope bridge) still had to be found by a player
falling through it.

Now each server installer calls `registerInstalled(host, key)` when it actually builds something
(`src/server/game/shardfile/installedSides.ts`, in the game layer because the game's installers can't import the host).
`src/server/host/installers.ts` names each key's owners and lists a product's sided kinds whose key never ran.
`test/side-installers.test.ts` boots every pinned product the way a room does and fails on one.

Red first: with the `installRopeDecks` call removed, Driftwood fails naming `world.assembly rope-deck (ropeDecks)` and
`rope-chain`. SS4 to SS6 had landed already, so none of their lines is a known red. The test found five open lines, all
pinned under KNOWN: Driftwood's `quest.continuation` (keepsakes), Nalati's `state.adventure` (saves) and Nine Dragon's
`world.sets` (places) go to the new row SS3b. Driftwood's and Nine Dragon's page-only `view.program` rows go to HS6,
because SS2 sides every `view.program` as `both` for Nalati's slots and open arena.

The marks are deliberately narrow. A data cell claims `collision` only when it built prop solids, and the runtime plan's
one-slot loadout claims no `loadout`. A false green is worse than a known red.
