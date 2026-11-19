# The other memory numbers on the budget verdict (BUDGET-CAPS BC11)

> Written by: Claude (lane opus-caps2)

The native footprint, Nine's WebKit ledger, the walk and Nine's boot and street ceilings now judge through
`scripts/budgets/verdict.mjs` with baselines in `budgets/baselines.json`, like the ledger and downloads already did.
Every hand margin went with `scripts/memory/gate.mjs`. J445 is the behaviour change: footprint mode used to refuse an
armed zone past 1.0 GB playing; that line is now a target (a report line and a table note) and 1.5 GB loading is the
one refusal. An armed zone's baseline is its own reading on its pinned revision, so a new shard revision moves its line.
Nine's boot fails ci only on held parts or a missing reading; its budgets are judged in `budgets.yml` after ci.

BC15 found two rough edges on main's first budgets runs. A ci run of a commit from before the budget tools existed
failed the job on a missing `cli.mjs` (now a notice). And main-watch blamed the landers of the default branch's tip,
because a workflow_run's head_sha is not the commit it measured; `budgets.yml` now names its source ci run in
`run-name`, and main-watch reads that run's commit.

The app-code baselines (js/*) were taken from a stale local build at 43c891e6; they are now the CI measure of main
f31a7d3f58 (budgets run 44475200178), session raw 4,401,289 B.

The first memory-footprint run on the verdict (44475200066, main f31a7d3f58) passed and its 55 measures were
recorded with `record --run`: every armed zone now has its own playing and loading baseline.
