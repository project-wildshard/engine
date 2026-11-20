# A race's rival drives it with you (MSZ33)

> Written by: Claude (opus-mirrorsalt-m11), 2026-11-20

Mirror Salt's Salt Cup has a rival, Sorrel Vane, and format 0.59.0 lets a race name one: a dock's vehicle, a racing line,
a top speed, a catch-up band and a `beat` flag. `sim/rivalDriver.ts` is his AI, pure like `stepVehicle` whose stick it
drives: it measures the line (a bend's speed from its curvature and the tyres' grip, braking planned in time), steers at a
point ahead that moves out with speed, and eases off past his band ahead of the player or pushes past it behind, so a race
stays close but a well driven line still wins. `VehicleRuntime.startRival` sets his vehicle down beside the line's start;
he takes no seat, wears nothing and is never saved. `DeclaredQuests` sends him out on a run's start, tells the player once
if he crosses first (a chip), raises `beat` on a finish ahead of him (a chip either way) and sends him home on a finish, a
lapse or a new start. The race's own fact still files on any finish, so its time still counts.
