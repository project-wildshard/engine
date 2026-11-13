# Control waits for Pine's ground

> Written by: Claude (opus-pineflash), 2026-11-13

opus-pinefix (93e50340) gave Pine its ground back, but it still arrived late. opus-rel16's staging spawn shots on v0.1.16
showed the tan canyon walls of Pine's far proxy in the shot taken as control arrives; the textured tiles replaced them 1-2 s
later. A local preview showed the same on phone and desktop.

**Why.** The entered cell's tile views were admitted from `GridSession.step`, which waits for the grid background to open
(T10: 3 s of drawn play after control, or a 2 m walk). So Pine's ground could not even start loading until after control.

**Fix.** The loader's `spawnDetail` step first holds for the entered cell's ground (`grid/spawnGround.ts`,
`GridSession.prepareSpawnGround`): it admits the cell's tile views at once, pins all 16 L1 quadrants (each one hides one far
proxy region) and the spawn's L0 ring, steps the rings while no page frame does, and ends when they are published or after
8 s. Only a runtime-drawn cell whose ground is its ring tiles holds. Nalati (`cellGround: 'world'`) and a runtime in the
tile registration skip it. Driftwood holds too: its hill also showed the proxy's smooth mound, with no stairs, at control.

**Measured** in a headless local preview (one card spawn each, `grid-spawn-proof.mjs`): the hold took 0.58 s for Pine,
0.43 s for Driftwood and 0 for Nalati. Time to control moved within run-to-run noise: Pine 16.5 -> 16.9 s on the phone and
18.1 -> 18.0 s on desktop.
