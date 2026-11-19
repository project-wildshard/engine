# The vehicle handling step

> Written by: Claude (opus-mirrorsalt-m2), 2026-11-19

Meta MIRROR-SALT-ZONE MSZ7. `src/shared/engine/sim/vehicle.ts` steps a vehicle from a `world/vehicles` kind's handling:
throttle to `accel`, brake then reverse, coast, boost and the sail's wind; the heading swings no faster than the front
tyres hold (1.5 times the grip), and what it leaves sideways is slip the tyres pull back, less while sliding the more the
kind drifts. The slope pulls it and pitches and rolls it; walls come from the steer carry's floor probes, every 0.25 m
along the step, so no step passes into one. Pure and deterministic for MSZ8's server and MSZ16's replay.
