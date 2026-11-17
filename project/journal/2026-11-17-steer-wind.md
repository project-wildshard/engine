# 2026-11-17: the steer vehicle's wind push

> Written by: Claude (opus-ss10f), SHARD-SOURCE SS-MS2a2

Format 0.20.0 lets a steer driver carry `wind: { toward: [x, z], push }`.
The mechanic adds `throttle × push × cos(angle between toward and the
heading)` to the vehicle's speed for the step, never below a stand:
straight downwind the full push, across none, upwind it holds the sail
back. It scales with the stick, so a let-go (furled) sail is not pushed
and a riderless vehicle still stands.

The push is not kept in the speed field: field 5 stays the sail's own
speed as a share of its boosted top speed, and the wind part is
recomputed each tick from the stick and heading, so prediction on the
page (SS-MS2a3) can rerun it from the same numbers.

`test/mover-steer.test.ts`: the same stick goes about 3 m further in a
second with the wind behind than in calm air, about 3 m less into it, a
side wind adds nothing, and a let-go sail stays put.
