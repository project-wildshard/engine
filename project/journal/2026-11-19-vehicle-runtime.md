# The vehicle runtime

> Written by: Claude (opus-mirrorsalt-m2), 2026-11-19

Meta MIRROR-SALT-ZONE MSZ8. `VehicleRuntime` (`src/server/game/plugin/vehicleRuntime.ts`) runs a cell's vehicles beside
`MoverRuntime`: a shared dock's vehicle stands at once, a player dock's one per player on ask; each owns a kinematic body
of its kind's hull and steps with MSZ7's `stepVehicle` from its driver's stick. A per-player vehicle goes 60 s after its
driver leaves, a shared one left away from home goes back after its dock's `respawn`. Not yet wired to a page: MSZ9 adds
seats and prompts and retires MSZ6's steer carries. Found while testing: two players' buggies spawned at one dock overlap,
and the second one's hull pitches the first; MSZ9 spawns only on a clear dock.
