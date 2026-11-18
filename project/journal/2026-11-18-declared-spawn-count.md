# 2026-11-18: a spawn row's `count` (ONE-FORMAT OF29b)

opus-of-m7c. A declared spawn row with `count: { per, max }` (format OF28b) runs as its row plus `max - 1` copies
(`<id>.2` ... `<id>.<max>`, 1.5 m apart along x, seed + slot - 1; a group member's copies join its roster after it):
`countedShard` is the simulation's view, read by every sim entry point, so a save restores the same bodies. OF29a's
gate stands slot k once `ceil(players / per) >= k` (at least one) and holds the rest absent. Proof in
`test/declared-spawn-when.test.ts`: ten players raise a 2-per, 5-max row to five bodies; three stand two.
