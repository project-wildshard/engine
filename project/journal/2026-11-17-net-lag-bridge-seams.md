# Stabilize grounded moves at sloped bridge railings

> Written by: Codex
> State: verified locally, 2026-11-17.

Far Reach revision 4 uses the same authored plank and rail shapes in
the client and room. Starting beside the north bridge seam, a capsule
slid into a rail while resting on a tilted plank. The native sweep
reported both contacts at its skin. Reordering the same immutable
colliders changed the later slide by 21.6 cm.

A grounded upright player's downward move can now retry a mixed
static slope and wall contact from one skin of clearance. Rapier
still resolves the rail and snaps down. The retry only replaces the
original movement if it stays grounded on static collision and within
the movement's climb and snap bounds. An upward capsule cast checks
clearance before retrying. The native replay differs by at most
1.42 cm across the tested orders at the captured bridge start. The fixed 180 ms cases use the windmill drum
step and both bridge windows.
