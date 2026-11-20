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
