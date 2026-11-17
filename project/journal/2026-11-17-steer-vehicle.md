# 2026-11-17 the steer vehicle (opus-ss10f)

Mirror Salt's land-sail is a vehicle the player steers (SHARD-SOURCE
SS-MS2a1b). Format 0.19.0 lets a native carry `channel` mover take a
`steer` driver: top speed, turn rate, boost, acceleration and ground
follow. Carry already seated a rider (Pine's boat, Sky's cable car); only
its path was fixed.

`MoverMechanic` runs the driver. A board press (carry's first prompt)
seats the rider, the leave press (the second) puts them down at the
first landing; on a steer vehicle both prompts and landings are in the
vehicle's own frame (x right, z back), so they ride with it. While ridden,
the rider's stick, read from the command the host took this tick
(`SimHost.tickCommand`) and split into forward and right in the
vehicle's frame, sets a target speed and a turn; boost multiplies the
top speed. A riderless vehicle slows to a stand and stays. It does not
reverse: a back stick brakes. Speed rides field 5 as a share of the
boosted top speed, since mover fields are 0 to 1.

The stick and the ground under the vehicle reach the mechanic as five
numbers after the twelve every mover reads (`steerInput`,
`steerFrame`), so the composed lane keeps its one numeric ABI. A
ground follower takes the floor a probe finds 2 m above to 4 m below it,
and keeps its height over a gap.

Not yet: the wind push (SS-MS2a2), the page's prediction, camera and HUD
(SS-MS2a3), and the sdk part and Mirror Salt's sail (SS-MS2a4).
`test/mover-steer.test.ts` boards, steers a curve, boosts and leaves.
