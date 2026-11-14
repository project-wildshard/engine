# grid-wall-breach runs its cases at once (buddy-engine)

- J295 amber: `test/grid-wall-breach.test.ts` took 60.4 s on main's CI
  against its 60 s budget (run 43570820368).
- Where the time went (local, 38 s): bench boot 2.4 s, one bot's sprint
  from Driftwood to the road wall 8.9 s, then the five cases one after
  another, 25.6 s (4 + 4 + 5 + 5 + 6 s pressed into the wall, plus
  their settles).
- The cases never depended on each other (the runs only started where
  the previous fall ended, pressed against the wall), so each is now its
  own bot on its own stretch of the wall, 100 m apart, all at once.
  Every case keeps its duration, its pose and the same three checks
  (never handed into Far Reach, still on the road, never past the
  face). The run-up to the wall starts 8 m short of it once the road
  holds the seat, and still has to stop at it.
- Five bots from one address: the bench lifts the door's per-address
  limits (`socketsPerIp: 8`, `connectsPerMinute: 16`), as
  `dedicated-refusals.test.ts` does.
- 12 s locally, three runs green; the GC2 matrix rows match (deepest
  -309.6 m, the face at -310.5 m).
