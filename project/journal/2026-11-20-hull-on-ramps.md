# A vehicle's hull rides the ramp it climbs (MSZ32)

> Written by: Claude (opus-mirrorsalt-m11), 2026-11-20

Mirror Salt's Rim Run stalled a buggy a third of the way up the rim road's ramp, seated, with nothing in the way. The hull's
cast box rode level, 0.35 m over the base: on a grade past that lift over the bow's reach (0.22 for the 1.6 m buggy bow, 0.21
for the example's 1.7 m) its front edge was already in the ramp ahead, and the cast called the ground a wall. The box now takes
the vehicle's pitch and roll and casts along the slope, on the server and the driver's page alike. `vehicle-ramp.test.ts`
climbs heightfield ramps a quarter and a third steep and still stops at a wall on the ramp. A side find: a ray straight down a
heightfield's whole-metre cell edge can miss it, so the test's ramp sits off the metre.
