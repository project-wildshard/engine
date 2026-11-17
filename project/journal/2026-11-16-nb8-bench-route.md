# NB8: benchmax follows Nine's streets (mini-nb8k)

- NB1's play (forward, yaw +0.008 a tick, boost after 10 s) wedged the board in an alley at (21.6, 17.3) on Nine for a
  third to half of the minute; NB8's walk p95 was measuring that all-wall view, not a path a player holds.
- `--route nine` (the default on Nine): square, south street to z -95 and back, stair-street to x 36 and back. Each
  waypoint stops the player there facing the next (boost keeps up to 56 m/s through a turn, so steering alone slides
  into walls); a stuck board is put on its next waypoint, counted in the output. `p.spawn` alone is not a teleport on a
  worker page: the server owns the position, so the stop also calls `player.link.place` (as the probe's `pose` does),
  with the current y (Nine's floor is built at 125 m; the ground under it resets the player to spawn).
- The north street is outside Nine's bounds (the board stops at z 19.6).
- Back to back on one build (b9adfb09 + candidate Nine 335e5cba): spin 0.758 / 0.780 M, nine 1.125 / 1.141 M, 0 stuck;
  nine's peak is the view north up the south street from z -60..-90 (meta NINE-DRAGON-BENCHMAX NB8 / NB23).
