# 2026-11-18: a steer vehicle's hull (SHARD-SOURCE SS-GP5)

- Mirror Salt's parked land-sail had no collider on any page: the sdk lowers a vehicle to a carry `channel`, and format
  0.21 (engine's pin) refuses boxes on a channel, so the row could not carry them. Bumping engine's format pin is not a
  one-row job, so the hull rides in a row the format already admits: the vehicle panel's own `props.colliders` row.
- `vehicleHulls(source)` turns those boxes into the vehicle's frame; `MoverRuntime` (server) and `FollowedMovers` (page,
  data page, grid cell, client-plan page) build it as the vehicle's kinematic body, so it rides the vehicle like a
  platform's deck. The sdk writes the row `initialActive: false`, so an engine before this leaves it off: no static ghost
  at the parking spot, and no shard needs a new engine to keep riding.
- Surprise: the steer ground probe hit the vehicle's own hull and climbed onto it every tick (the riderless sail rose
  until the walker passed under). The probe now skips colliders the vehicle owns. `test/vehicle-hull.test.ts` fails
  without either half.
- The rider is led (no motor) while carried, so sitting inside the hull box is fine; landings are beside the footprint.
