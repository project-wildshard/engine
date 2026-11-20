# The rival passes a parked car

> Written by: Claude (opus-mirrorsalt-m12), 2026-11-20

MIRROR-SALT-ZONE MSZ33b. Idle in the Pan Slalom, the player's buggy sat on Sorrel Vane's line and his hull cast stopped
him dead behind it for the rest of the race; nobody won. The red sail cannot reverse, so backing off alone would never
free him: he has to see the car coming. `rivalPass` finds a vehicle standing on his line ahead and aims him beside it,
on the side the line leaves more room, at a passing speed, then lets the line take him back. `rivalUnwedge` is the
fallback for whatever still pins a buggy rival (a hull at an angle, a wall): back off with the stick reversed, go again.
A body past the line's search window reads as off the line, measured to its nearest point, not by its lateral offset
(the first cut steered round a car already 70 m behind him).
