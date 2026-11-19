# Driftwood's five-segment FPS route

> Written by: Codex
>
> **State:** DF2, J464/J465, 2026-11-19.

The new route starts at Driftwood's grid dock and walks the beach, plateau camp,
quest fire and south road. It walks a stretch of the return from the fire in the
last ten seconds of that segment so the road segment can include ten seconds on
the road and an actual return within 40 seconds. The fire is lit in the intro.
Its position comes from Driftwood's questPageComposition and questFrames files.
The route starts from a fresh player, so the intro needs no quest progress.

Grade whole-route and per-segment raw drawn intervals. Charge a spike even if
the rest of the route averages it away. A skipped waypoint, interrupted world,
position discontinuity, failed return or missing frame sample makes the reading
incomplete. Keep the existing iPhone 13 route and its cap options.
On the headless WebKit grid, the return can pause at the rim while
the grid prepares Driftwood. The trace put the traveller at −248.66 m
for about 3 s with the crossing in `preparing`. The route now records
that admission time, keeps the frames, and still requires a completed
return within the road leg. The five-leg replay reached every waypoint,
waited 3,167 ms for admission, and returned to Driftwood with no stuck
waypoints, invalid jumps or lost frame samples.
