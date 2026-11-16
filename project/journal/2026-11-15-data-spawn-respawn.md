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

## TC-E5b, first half: a mover's panel follows the wire in a grid cell

A shard with no client plan drew no mover body: the page posed movers only through a `scene.motion` row. Now a mover's
look is the props panel with its id: `NeighbourPanels.admit` registers a `wirePage.movers` view for each such row, and
`moverPanelPose` sets the panel to pose x rest^-1 x its baked transform, so a hinge turns about the mover's origin
(`src/client/game/grid/neighbour-mover-panel.test.ts`). Open: the browser proof on a cell whose shard carries one
(Mossgate's lift, TC-M4b), and the page-side collider for prediction.

Review (claude -p, before the land): MUST, a revived body lost its capsule. A data cell runs no body bands, so a dead
body keeps its motor and nothing makes a new one; revive disposed it. It now stands the kept capsule at the spawn
(`AnimalMotor.resetAt`, which `CharacterMotor` has). SHOULD, a mover panel was hidden until its first pose: it is drawn
at rest. Left open: mover views are keyed by mover id, so two cells declaring the same id share one view; a product's
published places are not filtered by `respawn: false` (only map POIs are).
