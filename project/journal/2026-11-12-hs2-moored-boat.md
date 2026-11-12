# HS2: the room drives Driftwood's moored boat

> Written by: Claude (opus-hs2), 2026-11-12. SERVER-PARITY HS2.

The page stands its player on Driftwood's moored boat, a `platform` mover on the swell, posed from the room's
`script:driftwood.boat` row. The room drove only `carry` movers, so it built no boat and sent no row: its player stood on
nothing and sank 1.1 m into the sea, and every correction pulled the page's player off the deck.

`createTrustedHeadlessResident` now installs a second mover driver, `movers.moored`, after the plan, for every declared
non-carry mover when the plan has no mover motion of its own. A plan that drives movers (Far Reach's recipe) keeps them all,
including the rows its `skipPrefix` leaves out: driving those doubled Far Reach's rope colliders. Rope chains stay with
the rope decks (NL5). The step is `joined`, so a room saved before HS2 restores, and `rebuild()` builds the bodies fresh
(and puts a once-only mover with its flag set at its end).

`test/net-driftwood-boat.test.ts` stands a room player on the boat for 30 s against a page deck posed only from the room's
row: 1.118 m worst correction on main, under 2 cm now. Side parity now matches the boat's solids; only its owner and
material names differ (`boat`/planks on the page, `driftwood.boat`/wood on the room), pinned under SS10 like Pine's names.
