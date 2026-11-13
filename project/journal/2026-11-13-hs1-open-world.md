# HS1: one world-build entry

> Written by: Claude (opus-parity), 2026-11-13. SERVER-PARITY HS1.

Each world was built more than once: a dedicated room and the phone's grid opened `openCellWorld` (the trusted resident, then
chapters, doors, discoveries, the owned book, lone walls, the fall floor), while the headless tick adapter that shard CI
journeys and the bake worker run booted the bare `createTrustedHeadlessResident`, a world no player runs. Shard journeys
installed chapters by hand (Nalati's taming journey) to test what a room does.

`src/server/host/openWorld.ts`: `openWorld(input, { room, saves, cell, snapshot, ... })` opens the room's composition;
`DedicatedRoom.boot` calls it. `openWorldAdapter` is the tick adapter on that world (a room: whole solids, no page), with the
resident's own fall net for every player. The bake worker ticks a native product on it. `SimHost.stepIds()` lists the
fixed-step owners, and `test/open-world.test.ts` boots every pin as a room and through the adapter and compares them: on the
bare resident 7 pins failed (Nalati had no king, patrols, stealth or story chapters; every native pin lacked the owned book).

Left: a runtime plan sent as sections with no product still ticks the bare resident (Far Reach's and Dunes' proof
witnesses build their checkpoints that way). `createTrustedHeadlessAdapter` is deprecated; shard CI moves to
`@wildshard/engine/host/openWorld` once it pins this engine.

## SS1's owed Driftwood lines (HS7)

Two Driftwood `known` lines in `test/side-parity.allow.json` had no open row. `sideParityDiff` now takes a `same` entry's
material (`sameMaterial`: the boat is `boat` planks on the page and `driftwood.boat` wood in the room, the same five solids
since HS2) and `chunked` owners, whose page copies of one piece under another chunk's owner are that one piece (the pier deck
is registered in four chunks, its landings in two). Two copies in one chunk stay two, and a stale material or chunked owner
fails. Driftwood's only `known` line left is the castaway (SS10b).

## A restored world's doors stood still (opus-hs1)

Moving Pine Hollow's `product-play` onto `openWorldAdapter` failed its resume check: a world restored from the adapter's
commit had different physics bytes from the one that never stopped, from the first step. Bisected to `installServerDoors`:
it posed every leaf at install, and on a restored world that re-set an already-placed collider by an f32 rounding error,
which re-files it in the broad phase. Now a restored world (`openCellWorld` with a snapshot) leaves its leaves where the save
put them, and reads the shut pose by turning the standing one back, so a door saved open no longer swings twice. The open
world test now resumes every native pin through the adapter and compares the next steps byte for byte.
