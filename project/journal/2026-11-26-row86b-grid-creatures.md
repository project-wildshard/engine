# A grid creature's hit presents once, with its number, and its return shows (opus-chunk2, meta QA 11-25 row 86 (b))

- On the grid a creature hit or kill presented twice (two damage reports, two squeals, two death callbacks), with no
  damage number; a killed creature's network body never left the client, and its authored return never showed.
- Twice: the cell's weapons hit creatures through `authoredTargets(app.events, regional.animals, …)`, which raycast them
  on the wire too. The one-shard page's loadout raycast them only off the wire (`player.link === null`), so the server
  settled each blow and its `hit` presented it once (J47). `authoredTargets` now takes the rule as a required argument
  (`settles`), and both callers pass `player.link === null`.
- No number: the page's play wires its HUD on its own creatures' manager (Combat's floats, the kill feed, the cries). An
  entered cell's creatures are another manager that nothing heard. `presentThrough` (src/client/game/grid/
  cellPresentation.ts) sends them through the page's while the cell is entered, after what the cell's manager says, and
  takes a hit point from the region's frame to the world's for the camera. Not `onWindup` (QA row 86 (c)).
- No return: Driftwood's return revives the killed boar in place, under its id (AnimalSim.revive). The room kept its
  handle, and a page that showed the death holds a ragdoll that never stands up again (AnimalView.update), so the corpse
  stayed and the return never showed. `revive` of a dead body now counts a life (`lives`), and a life takes a fresh
  handle through NetHandles' renewal (as a changed Name does): the old handle's hits and death, its despawn, then the new
  spawn. The wire is unchanged. Every revive gets this: native returns, timed respawns, spawn scripts, encounter adds and a
  boss's reset.
- worker-client-returns.mjs S3: a return keeps its id by design, so the check now asks that the dead handle left the
  client and the id came back alive under a fresh one, not for a new id.
- Tests: test/grid-creature-return.test.ts (the real Driftwood cell: a kill keeps the handle, the return renews it) and
  test/grid-creature-presentation.test.ts (off-wire targets, the practice room, presentThrough and its undo).
