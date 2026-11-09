# A proof covers its executed exclusion scope

Opus MUST-FIX3 reproduces against published7490d38 with a real Git-bound
policy and actual wall-clock expiry. Before expiry, the fixture's complete
gate executes its visible test and excludes one deliberately failing file.
After expiry the same policy reader restores that actual file and its
gate fails, but the old cache still returns the earlier green proof.
There is no mocked clock, renewed deadline or fabricated file result.

Version2 receipts store the exact sorted excluded set and its immutable
deadline. Capture fingerprints this scope alongside the existing runtime
and tree. Read rechecks current policy state even when handed an earlier
context; write refuses a scope that changes while its gate is checking.
The same readLiftPending implementation used by Vitest supplies the state,
including original Git admission validation. Incomplete or invalid policy
fails closed. Old receipts cannot qualify. CI still never reuses a proof;
local pushEnvironment removes ring/quarantine modes, so every quarantined
file remains in its full inventory and the lift policy is its timed scope.

The real protocol is green in4.17s: deadline expiry, changed inventory and
changed/invalid deadline each invalidate the earlier context. A stale
context cannot write a fresh proof. The previously excluded fixture really
runs and fails after expiry; the receipt records its original set/deadline.
The manual proof is outside automatic hook/Vitest discovery. Existing
scope, dirty-tree, changed-compiler, actual-Git and two-real-lease checks
remain required before publication. No exclusion, deadline or extension
is edited in the actual engine policy, and no omitted test is credited.
