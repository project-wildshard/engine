# Smooth steps and refuse wall support

The normal character controller already auto-steps a walkable ledge.
Smooth the eye over those changes without moving the collider or
holding back the camera through a jump or teleport.

The board's old solid ray called the inside of a vertical wall a
floor at distance zero. Each spring step then boosted it farther up
the wall. Require an upward contact within the walkable slope for
the board's floor. Walking jumps recharge on walkable ground. The
ordinary airborne follow-up still has its one charge.

QA feedback 2026-11-19 rows 43 and 45. Native traces cover a real
step, the camera's height, world-edge and building wall spam, and
positive jumps on flat ground for both forms of movement.
