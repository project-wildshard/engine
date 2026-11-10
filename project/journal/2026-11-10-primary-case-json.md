# Publish primary shard case outcomes as actual JSON

The primary native/ordinary shard artifacts previously contained only
module state and clocks. A default job-log case total is not an
authoritative per-file qualification record. It must not be used to
retroactively qualify the tape proof or infer missing executions.

Schema engine-ci-budget/2 keeps all existing fields and adds global
errorCount, run attempt, and each module's errorCount, caseCounts and
cases. Cases are the actual Vitest children, with full names, result
states and declared modes. Counts partition total into passed, failed,
skipped and pending; todo has Vitest state skipped and mode todo.
Missing execution stays distinguishable from actual failed cases.

Existing artifact paths are unchanged. Both full and Ring 1 already
upload every native/ordinary phase JSON from tmp/engine-ci. There is
no file/shard/case budget, assertion, isolation or membership change.
The collector owner must use new complete-prefix evidence; old clocks
or job logs do not acquire retroactive authoritative case counts.

The outside-hook real Vitest proof compares the reporter with Vitest's
own JSON on passing, failing, skipped, todo and unhandled outcomes.
Original wall/import budget refusal cases remain unchanged.

The review forwards compare every case identity/state with builtin
JSON, preserve declared modes, and assert module error counts and the
count partition. A real collection refusal reports zero cases and one
module error. A real failed setup reports one unexecuted run-mode case
as framework-skipped and one module error. These facts are retained;
no pending-state execution or retroactive qualification is claimed.
