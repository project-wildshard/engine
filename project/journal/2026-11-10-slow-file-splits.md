# VITEST-BENCH VB5: the last two files over 20 s alone, split by case

Plan: meta `docs/plans/VITEST-BENCH-PLAN.md`, row VB5 (J227: "every file over
20 s alone is rewritten or split by case"). Lane `opus-vitestbuild`.

`test/standalone-grid.test.ts` (31 s alone in the inventory) spends its time
waiting: a real client walks on the standalone server's own clock, over real
MessagePorts. A fake clock would change what it proves, so the cases moved
apart instead, each body byte for byte the original:

- `standalone-grid.test.ts`: the road-to-Driftwood walk and its two reloads.
- `standalone-grid-lone.test.ts`: both lone-cell walls and the fall.
- `standalone-grid-restore.test.ts`: Nine Dragon's deck and J68's far solids.

The shared server, page storage, walk and `until` helpers live in
`test/fixtures/standaloneGrid.ts`; `running` became a getter, since a module
`let` cannot be imported live as a value the test reassigns.

`test/engine-rule-successors.test.ts` (26 s) keeps its four independent
cases. The Titan chain, whose thirteen cases each resume the save the one
before earned, moves whole to `engine-rule-successors-titan.test.ts` and
admits only Nalati, the one product it plays. Both files share
`test/fixtures/engine-lift/residents.ts` for admission, `step` and `press`.

Before and after, one worker in a 2-slot CPU grant (`cpu-admission.py run`), load 11–28.
A first cut kept J68 with the road walk; that file ran 19–20 s, so J68 moved.

| File | Wall s | CPU s |
|---|---|---|
| standalone-grid (before) | 33.2, 34.4 | 13.6, 15.3 |
| standalone-grid (road walk only) | 14.0, 17.1 | 10.3, 11.5 |
| standalone-grid-lone | 16.2–18.6 | 4.2–5.6 |
| standalone-grid-restore | 11.7, 13.6 | 11.6, 13.2 |
| engine-rule-successors (before) | 23.3, 29.8 | 34.4, 39.7 |
| engine-rule-successors | 5.9–10.6 | 9.7–14.3 |
| engine-rule-successors-titan | 15.0–27.4, median 20.5 | 23–35 |

The Titan chain stays near 20 s under load: it is real simulation, 6,000
ticks a phase at most, and the per-step product CPU is VB6's (engine), not a
test's. Every new file joins its parent's CI native group and ring-2 list.
The Titan file registers Nalati in `scripts/test-products.json`. The grid had
no entry there, so product preflight never covered it; the J206 review caught
that, and each grid file now lists the products it was seen to load
(road walk: Sunscar, Driftwood; lone: Sunscar, Pastel; restore: Sunscar,
Nine Dragon, Nalati).
