# Declared riding (ONE-FORMAT CC40b1)

A species row with `mount` is now ridden on the declared path by one
primitive, `declaredRiding.ts`: the ride act mounts the nearest mount
creature in reach, the reins drive `MountedBody` at the row's gaits,
and the seat saves through its own step adapter. The horse's own
capsule is disabled while ridden, or the mount capsule pushes against
it and the pair stalls at a walk. Data cells route `ride` acts now;
before, they were counted as refused.

## Flying mounts (CC40b2)

A `fly: true` mount takes off on a jump press, climbs at its `flight`
row's `climbRate` to its `altitude` (at least 4 m), flies at the
reins' gaits with the motor capsule disabled, and a second jump
dives it at `diveRate` back to the ground, where the motor is reset
under it. The flight row has no airspeed of its own, so the gallop
gait is the flying speed. Saves carry the lift and phase.
