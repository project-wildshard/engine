# Grid data cell lanes read shared state (opus-te2e5, TEMPLATE-E2E TC-SHIP-d2)

- On staging v0.1.37 Brasscap's grid page read `life.failed: Declared client reads require an owned state view`:
  `NeighbourLife` built a data cell's client lane with no `state` port, so any cell whose client scripts read shared
  state lost its whole lane. The Wyrm's gullet glow and sand-ring tell (and every other particle in the cell) never drew.
- The lane now gets a `viewField` that reads a public shared row off the wire where it stands (`LiveGridSession.lifeField`,
  as `panelRegion`'s `field` does), else the declared default. `test/neighbour-life-state-reads.test.ts` was red first.
- The probe gap that hid it: the play probe held fire whenever the Wyrm's y was under -0.5, and the Wyrm rests at -1.29 in
  its mound, so it never fired at an open gullet (fixed in shard-brasscap's probe).
