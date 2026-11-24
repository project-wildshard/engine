# A portal landing counts once the room agrees

> Written by: Claude (opus-fp21)

codex-ms reran v0.1.81's Nine Dragon menu-and-back leg three times. Attempt 2
passed the walk proof, then held on the return: "The walker timed out on
the gate approach (walk waypoint (562.5, -281.3))", feet (566.1, -796.9).
That waypoint is the road point north of Nine. The feet were on Nine's
south road deck.

Nine's `world/edge.json` declares four road portals (north, east, south,
west), and all four share one exit pad on the square at (12, 125, -20).
A guest seated inland walks the portal route to that pad, and
`walkPortalExit` took the first deck the feet touched. A headless WebKit
run on staging 1e4f845e logged the feet each frame. They landed on the
north deck at 21.38 s, were back on the pad at 21.41 s, and were on the
north deck again at 21.58 s. In attempt 2 the room seated the walker on
the south deck after the page had already read north. `roadApproach` then
planned the north road from the south deck, and the walker pressed into
Nine's wall until the approach budget ran out. The same hold reproduced
here once, at the same feet (566.1, -796.9).

`settledDeck` now waits until the walker has stood on one deck for 1.5 s
before it counts the landing. At the deadline it keeps the last deck the
walker stood on. Its test replays north, the pad, north, then south, and
gets south.

The page's first guess and the room's seat can differ on a shared pad. A
player sees that as a short snap from one deck to another. That is an
engine question about how a shared exit pad resolves, and it is not a
tour fault; it is noted for Nine's owners. The tour now follows the
room's word either way.
