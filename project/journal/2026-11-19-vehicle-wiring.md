# Vehicles on the wire

> Written by: Claude (opus-mirrorsalt-m3), 2026-11-19

Meta MIRROR-SALT-ZONE MSZ9b. Both server paths (`bindShardfileSim`, the native plan in `headlessRuntime.ts`) now run a
product's `world/vehicles` in `VehicleRuntime` (`installVehicles`) instead of MSZ6's lowered steer carries; `dockedShard`
and `dockedMovers` are gone. Each vehicle out is a `script:` row of its own (withdrawn when a per-player one despawns),
each taken seat a `state` row (`vehicle.seat|<vehicle>|<seat>|<player>`), and a rider's leave press goes by
`<vehicle>.leave`. A per-player vehicle's id is `<dock>:<player>`: an act's id takes only `[a-zA-Z0-9._:-]`, so MSZ8's
`~` never reached the server. Seated bodies answer `player.traversal`, so their walk stands down. Saves keep every vehicle,
its state, seats and body handle (a save from before restores with the shared ones fresh at their docks).

Each page path (data page, grid data cell, scene client plan) follows those rows with `FollowedVehicles`: a hull body per
vehicle made on its first row, a fixed few prompts that follow the nearest free seat, each clear player dock and this
player's way out, and (data page only, for now) a copy of the kind's panel. The play list's `rides` entry puts a seated
player in the reserved `drive` mode (a traversal) and gives the view the steer ride's turn and swing-back, with the speed
on the steer chip. `test/dedicated-vehicle-drive.test.ts` boards the example buggy over real sockets, drives it 20 m and
gets out.
