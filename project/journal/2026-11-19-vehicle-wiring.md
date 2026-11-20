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

**MSZ12, controls on phone and desktop.** A seat pushes the `drive` input context. It blocks the walk's verbs (jump,
dodge, sprint, hover, attack, aim, lock, crouch), so TouchControls hides ATTACK, JUMP, DODGE and the HOVER tab on its
own, because a disc shows only while its action is live. `DriveDiscs` takes their places: BRAKE in ATTACK's spot and
size, BOOST in JUMP's, HORN in DODGE's, and LEAVE as a tab where HOVER was. The USE band, which would also read *Get out*,
hides behind LEAVE. Keys: Shift boosts, Space is the handbrake, H the horn, V the view, E still gets out (`use` stays
live), and W A S D are the stick. `Player.seatButtons` rewrites the wire's buttons while seated. The walk's buttons go,
including the sprint a phone's stick sends when pushed all the way, so only BOOST boosts. Three new held bits ride the
16-bit buttons field: `brake`, `handbrake` and `horn`. A BRAKE held 0.35 s becomes the handbrake. BRAKE stops the
vehicle and holds it (`VehicleCommand.brake`); the back stick goes on into reverse. The server's `driverStick` reads the
raw stick as the vehicle's own: forward throttles and the side turns, whichever way the driver looks. Before this, a
driver looking round in the chase view turned the car, because the stick was a world move projected on the heading.
That broke `dedicated-vehicle-drive`, whose bot steered by its view, so it now steers its stick toward -x. The gauge
shows R N D off the speed along the heading. The touch tape on local phone WebKit (`scripts/parity/vehicle-touch.mjs`)
is split out as MSZ12b, because no local build carries a vehicle yet: sharddev's example is engine-test-only until it
pins format 0.53.0, and Mirror Salt's vehicles come with MSZ22.
