# Declared riding (ONE-FORMAT CC40b1)

A species row with `mount` is now ridden on the declared path by one
primitive, `declaredRiding.ts`: the ride act mounts the nearest mount
creature in reach, the reins drive `MountedBody` at the row's gaits,
and the seat saves through its own step adapter. The horse's own
capsule is disabled while ridden, or the mount capsule pushes against
it and the pair stalls at a walk. Data cells route `ride` acts now;
before, they were counted as refused.
