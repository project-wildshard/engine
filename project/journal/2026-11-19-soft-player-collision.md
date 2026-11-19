# Players no longer walk through each other

QA 11-19 row 54 (Jake, 16:13 Cancún, iPhone 17 Pro, staging v0.1.52, on
Driftwood's dock with another player): "there's no collision boxes ... we
walk through each other." The server never put players in each other's
way, and nor did the page.

The pick is soft collision, on each page, for its own player only
(`src/client/engine/net/softCollide.ts`). Each body is the player
capsule's width (0.38 m radius, so 0.76 m centre to centre). The page
bends the move each step sends. The server steps that bent move through
the same character controller as any other. Walls hold, nothing fights
the reconcile, and the server's movement checks are unchanged.

- Walking at someone: the part of the move toward them fades from 1.26 m
  (sooner when closing fast, by 0.12 s of closing speed) to 70% gone at
  contact and all gone 0.2 m inside it. Off centre, you slide round them.
- Pressing in shoves a free player along at about 0.7 m/s. Only the one
  being pressed gives way.
- Two bodies that overlap each steer apart, up to 0.4 of a stick at
  0.3 m deep. The push eases on over 0.1 s and lets go at once, so they
  settle at contact instead of coasting past it.
- Another body is drawn about 100 ms late, so it is led by its drawn
  velocity times the interpolation delay plus 50 ms. A body that seems to
  have crossed while you walk into it stays on the side you met it from,
  so a fast head-on meeting doesn't tunnel through.
- Nobody can hold you. A player stuck pressing into a body (moving under
  0.35 m/s for 1.2 s) passes through it, until they are 1.16 m apart.
- A push toward deep water is dropped (the dodge's 0.5 m pier-edge
  probe). A dodge is never bent. A board, water, a saddle, a carry or a
  crossing lets go. Bodies 1.6 m apart in height don't meet. NPCs and
  creatures are untouched: creatures already have predicted capsules.

Proof: `soft-collide.test.ts`, 15 cases, including a 150 ms-late head-on
meeting in a 1.5 m gap. `scripts/soft-collide-proof.mjs` runs two
headless WebKit phones at 402×874 in a local Driftwood room. Walking into
a still player: closest 0.556 m on Jake's page and 0.677 m on Jimmy's,
Jimmy shoved 0.77 m, settled at 0.79 m with no reversal. Head-on in a
1.5 m lane: they stop at 0.56 m, pass 1.45 s after meeting, and stay
within 0.064 m of the line.
