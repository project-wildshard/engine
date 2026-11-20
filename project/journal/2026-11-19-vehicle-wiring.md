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

**MSZ10, the sit.** Another page's `OtherPlayers` asks the page's vehicles (`wirePage.vehicleSeat`) for each body's seat: a
seated body faces its vehicle's heading, never strides or holds an item, and poses the seat by bending bones (no sit clip
yet): a `sit` seat folds thighs and knees with the hips 11 cm over the seat's base, a `stand` seat softens the knees, and
both hold the controls at chest height. `scripts/vehicle-seat-shots.mjs` bundles the page's own `OtherPlayers` with rolldown
(Rapier's wasm module aliased as vite does, `import.meta.env` defined, chunks served by a Playwright route) and shoots the
example's buggy and land-sail from a second page. A blind Opus judge failed round 1 (arms straight out like a zombie reach,
hips 10 cm low) and passed round 2.

**MSZ11, the view from the seat.** Jake's call 7 took B: first person from the seat, a chase view one press away. A seat
now hands the page's `Player` an eye (`Player.eye`, a new slot beside `ride`: it poses the camera instead of the feet's
eye, and the look stays the player's). `SeatEye` (`plugin/seatView.ts`) reads the vehicle's drawn pose at the camera's
pose, so the eye never lags the vehicle by a frame: the seat's base plus 0.88 m seated (hips 0.11 m over the base, as
MSZ10 poses other pages' riders, then 0.78 m to the eye) or 1.6 m standing. Boarding and the swing-back set the look
down 0.15 rad, so the road fills the middle and the bonnet the bottom. Past 60% of top speed the view widens, +6 deg at
top and +14 deg at the boosted top. It widens through `camera.zoom`, because every held weapon writes `camera.fov`
each frame, and a second writer would fight them. The chase view is 6 m back and 1.4 m up. It pulls in at once at a wall
(`FollowedVehicles.clear`: a ray that passes through the vehicle's own hull) and tilts down as it does. V in a new `drive`
input context swaps the views (that context blocks dodge, which V is on foot), and so does a tap on the gauge. The held
item is stowed in a seat. A blind Opus judge failed round 1 for three problems: the land-sail's mast filled the middle
of the deck view (the stand-in's seat sat on the mast line, so MSZ22's sail must stand its driver off it), the phone
view was half sky, and the chase view at the wall cut the buggy off. Round 2 passed the deck view after its seat moved
off the mast line. Round 3 passed the phone view: a portrait view tips 0.2 rad further down (`PORTRAIT_DROP`), since no
one aims from a seat. Every round failed the wall shot, and this lane overruled it (Jake away). A chase arm pulled in to
1.5 m off the rear bumper cannot frame the bumper without looking straight down, so the wall view instead tilts up to
0.45 rad further down as it pulls in. The horizon stays and the cockpit stays in frame.
