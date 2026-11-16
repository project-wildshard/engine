# Data spawns respawn (TEMPLATE-E2E TC-E2)

> Written by: Claude (opus-brassgun5, from opus-brassgun4's drafts)

Jake (J361): the templates need enemies that come back, as Signal Dunes' do. A `creatures.spawns` row's optional
`respawn` (seconds, shard-format 0.5.8) now revives its body at its `at`, whole, that long after it dies
(`src/server/game/shardfile/dataRespawn.ts`, `AnimalSim.revive()`). The declared brain and group skip a dead actor
and resume once it stands, so reviving the body is enough. The waits are one host step adapter, so a save keeps the
clock, and `world.slept` spends it as declared homes do. The `dead:<id>` flag stays set: quests latch on it.

Same branch: a map POI with `respawn: false` (shard-format 0.5.10) leaves `dataCellPlaces`, so a death in Brasscap's
Wyrm pit no longer comes back in the pit (TC-E3's review SHOULD). Engine pins format ^0.5.10.

## TC-E5a: a cell's shared-trigger mover already turns

TC-E5 suspected the moored install in `headlessRuntime.ts` (no `activation.shared`, no permissions). That path serves only
products with a `sim/runtime-plan` or a native assembly; Mossgate (`_template`) and Brasscap (`blender-template`) have
neither, so their cells run `createShardfileSim`, whose `movers.declared` install already reads shared fields.
`test/data-cell-shared-mover.test.ts` proves it on Template's built product: a native `track` mover on a `shared` trigger
rises once the door hook sets field 101. Left for TC-E5b: the page drawing such a mover in a grid cell, and the sdk's
`defineShard` emitting `movers`.
