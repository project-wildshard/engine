# Vehicle prediction and replay (MIRROR-SALT-ZONE MSZ16)

> Written by: Claude (opus-mirrorsalt-m5)

- Until now a `world/vehicles` driver saw their vehicle only where the rows put it, a round trip behind the stick. The old
  steer ride's `SteerPrediction.settle` shifted its old steps by a row's gap, which is right only while a step is a straight
  line; MSZ7's slide and MSZ13's bounce are not.
- Now `VehiclePrediction` steps the driven vehicle on each command the page sends (`NetPlayer.onCommand`, so the count
  matches `predictor.pending` exactly), and on a disagreeing row takes the row's state and replays the unanswered commands
  through the page's own floor probe and hull cast. The hull cast and the stick read moved to shared `sim/vehicleHull.ts` so
  page and server cannot drift apart.
- Rows now carry a driven vehicle's `forward` and `slip` (`vehicleMotionRow`, two `state` rows while it has a driver): without
  them a knock only the server saw left the page's speed wrong until the stick pulled both back together.
- Drawn: a correction under 0.5 m eases out over 100 ms, a larger one snaps; the collider stands at the true prediction.
- Gotcha for tests: a collider added to a Rapier world is not seen by `castShape` until the world steps; the first page-side
  run went through the wall for that reason alone.
- `net-lag-proof.mjs --vehicle` drives a shard's nearest dock and prints corrections a minute; its live run waits on a local
  build with a dock (J475: pack the engine into the shard repo).

## MSZ17: two players

- `test/dedicated-vehicle-two.test.ts`: three bots in a dedicated cell over real sockets. A taken driver's seat refuses a
  second ask, a taken passenger seat too; each player's own buggy comes from the same player dock once it stands clear; a
  passenger stays led within 1.5 m of the seat through a full circle; a ram moves a parked, braking buggy and every seat holds.
  No engine change was needed: MSZ9's seats and MSZ13's bounce already held it; the passenger's page follows rows (MSZ16
  predicts only the driver's seat).

## MSZ18: what the MMO server must know

- The cell's edge is a wall to a vehicle, the whole square `VEHICLE_EDGE` (6 m) inside `CHUNK_HALF`, not only the gate roads:
  every way out of a cell is its edge, and a seated driver led past `CHUNK_HALF + CROSS_MARGIN` would cross with the seat
  emptying behind. Shared `edgeHit` in `sim/vehicleHull.ts`, so the driver's page predicts the same turn-back. The edge wears
  nothing; the driver's chip says *Vehicles stay in this zone* for 2.5 s (generic text: the chip has no zone name, and Mirror
  Salt's own wording can come with MSZ26's Start Yard pass if Jake wants the name).
- `VEHICLE_CAP` 24 a cell: a player dock's ask past it is refused. One per-player vehicle a player: asking at another player
  dock takes the first one back, its riders set down.
- Road rooms install no shard sim, so they run no vehicles; the grid test asserts it.
- `hostVehicles(host)` and `VehicleRuntime.place` let a test set a vehicle down: the example's ground ends at about x -184, so a
  drive from the dock never reaches the edge.
- The bench (`test/dedicated-vehicle-cell.test.ts`): 16 bots' buggies circling in one cell, 15 readings, tick p95 at most
  5.47 ms (p50 2.83 ms) against the box probe's 12 ms line, on the Mac mini. The door's 4 sockets an address needed
  `socketsPerIp: 32` for 16 bots. Frame bytes print with it for MSZ20's budget.

## MSZ19, first half: a rider saves at the dock

- Vehicles are not saved. `exportPlayer` asks `hostVehicles(host)?.docPlace(player)`: a seated rider's doc puts them on foot
  beside the dock nearest their vehicle (past its hull's side, on `clearStand` ground, facing the dock's way), so a rider who
  comes back after the hold, or into a fresh room, stands there. On foot the doc keeps their own place.
- Still owed on the row: unlocked kinds and colours and the last kind picked at a dock, in the player's `SaveStore`, and the
  unlock-reconnect save test.

## MSZ19, second half: what a player keeps of vehicles

- A `vehicles` slot in the player's shard document (`vehicleGarageSave`, admitted by `validPlayerStore`) keeps the kinds and
  colours unlocked and the last kind picked, through `VehicleGarage` (`PlayerOwned.garage`). Nothing unlocks yet: the garage
  (MSZ26) and quest grants will call `unlock` and `unlockColour`. Call made with Jake away: taking any driver's seat is the
  pick (`VehicleRuntime.picked`, heard in `cellWorld`), since a dock names one kind until the garage offers a choice.
- `test/dedicated-vehicle-save.test.ts`: a bot boards, is given a kind and a colour, drops while driving 20 m off, and comes
  back over a new socket on foot within 4 m of the dock with all of it kept.
