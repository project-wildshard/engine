# Main CI test budgets

> Written by: Codex
> **State:** 2026-11-17, QA-mini24 / J295 forward fix.

Main d3f2e7ec12 (44163978276) ran 89 land cases in 83.811 s.
Give local gates, hosted landing, preflight and workflow contracts
separate files. Keep the real Git fixture, all cases and timeouts.

Split the six online entry cases into gate entry and continuation.
Both use the existing fresh rooms and sockets, with the original
deadlines and assertions.

Use the offer-first pilot for the field approach only. The rounds
fixture uses the original inputs, avoiding a throw and long chase.
It still runs all five rounds, both restores and the companion call.
The local rounds trace went from 5,250 to 1,413 ticks, with the same
checkpoint at tick 765.

The rounds and entry files ran on the same 342.956 s charged shard.
A replay from the exact run's measured table separates those files
with 26 logical shards across the existing nine packed jobs and
a 225.026 s predicted maximum. The hosted measurements are the
acceptance check. Keep the 60 s file and 300 s wall caps.
