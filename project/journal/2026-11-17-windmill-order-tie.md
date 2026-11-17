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
- Starting grounded moves 0.5 mm above the skin (`restOnFlatFloor`) removes every difference in the probes, but the
  floor then comes from a shape cast with a small time of impact: feet wander 3 to 6 mm vertically, a tick can hop
  2 cm, and `road-rebind-speed` drops one tick to 89 % speed. Not shipped; NL13b5 owns a motor fix.
- `test/net-predict-collider-order.test.ts` gains the glancing walk, marked `test.fails` until that fix lands.
