# Grid data cells and their client plans (OF22e2 audit)

> Written by: Claude (opus-drift6)

Driftwood r7's staging walk failed, and the first guess was another grid data cell gap like Nine's claw. Driftwood is a
runtime client-plan cell on the grid, so it was not; but the audit found the real class: a data cell installs none of a
shard's `client/plan` features except its audio scene. Nine is the only pinned data cell with a plan, and seven of its
eight features never install on the grid (its staging grid shots show the city half built). `test/grid-data-cell-plan-parity.test.ts`
names those seven as known gaps and fails for any new one, so the next plain upload with a plan feature shows up in CI,
not in a walk.
