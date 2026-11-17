# The windmill corrections are a floor-and-wall tie, not the windmill's shape (NET-LAG NL13b4, opus-netlag2)

- Staging v0.1.35 with Far Reach rev 4 still corrected Chromium 8.5 to 18.4 times a minute, the kept misses at the
  windmill. The handoff guessed the tower box poking 0.25 m out of its drum.
- Probes in two worlds that differ only in build order (0 to 3 far-off boxes first, the windmill before or after the
  decks): rev 4's windmill parts 10 of 64 glancing walks by up to 20 cm. A drum hull that holds the tower's corners
  parts 11 of 64, one convex hull of drum and tower 16 of 64, a tower starting on the drum's top 9 of 64. A box wall
  on a plain box floor parts too once the floor is off the wall's centre (7 of 64); centred, it doesn't.
- The first difference is nearly always vertical, on a flat wall face: a grounded capsule leaning on a wall meets the
  floor and the wall both at time 0, inside the controller's 2 cm skin, and Rapier keeps whichever hit its query tree
  visits first. The page's tree and the room's are never built alike.
- First try, not kept: start grounded moves 0.5 mm above the skin with the fall still in them. Order-free, but the floor
  then comes from a shape cast with a small time of impact: feet wander 3 to 6 mm vertically, a tick hops 2 cm, and
  `road-rebind-speed` drops one tick to 89 % speed.
- Kept: a grounded sideways move on flat static support (`restOnFlatFloor`'s case) starts `REST_LIFT` 0.5 mm above the
  skin with no fall in it, so the floor is never hit and only a wall can be; when the move kept that height the feet go
  back onto the skin. Every probe parts by 0 (64 walks x 15 orders on Far Reach; box, hull and prism floors under box,
  drum and windmill walls), `road-rebind-speed` stays at 4.30 m/s, and the 31 motor test files pass. The allocating
  control fixture takes the same change, as it took NL13's.
- Ring 1's step digests move for Blender template, Far Reach, Driftwood, Pine and Nine (Template, Dunes and Nalati step
  the same): re-recorded with this change. Shard repos' own walk checkpoints are keyed per engine version and move at
  their next engine bump.
- Ring 1 recorded on darwin-arm64 after the rebase on `0bad938a`: two runs step the same; the five moved chains
  were copied into linux-x64 (CI says if Linux ever parts from Darwin here).
- The land gate then caught the recorded laws this moves: the eight motion traces, the page law at 60 and 24.3 frames/s
  and both Nalati room-bytes digests. With the lift switched off all twelve match the old records (the old-law
  control); re-recorded with MOTION_TRACE_RECORD=1 and the new room digests, two repeat runs the same.
