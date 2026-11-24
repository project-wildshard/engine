# Production proof covers planned grid heads

Brasscap r17 was hidden on production when v0.1.81 qualified. The live
heads all played, but the exact-build Brasscap index returned 404 when
row 27 tried to expose it. The gate must prove the heads a change will
publish before the production pointer moves.

Release branches can carry `scripts/server-release/production-grid-plan.json`.
Its `cells` array contains the proposed cell's `instance`, `cell`, `slug`,
`revision` and `hash` for each placement or visibility change. The server
release job reads the plan from the exact candidate. A separate grid
operation gives the same preflight its plan with `--grid-plan=<file>`
and uses its verdict for those exact cells before applying the update.

The preflight verifies the proposed heads' exact-build indexes with
both entry tiers, then advances each head through 600 real room ticks.
A proposed revision and the current revision both play when they differ.
The plan and catalogue must still match the inputs at the end of the run.
