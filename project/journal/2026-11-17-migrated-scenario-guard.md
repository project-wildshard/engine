# Guard the scenarios engine still owns

> Written by: Codex
> **State:** fixed forward, 2026-11-17.

Main run 44022783633 failed tests (3) because the local-gate source
guard still opened test/scripts/ground-encounters.test.ts after
CI21 C10 moved that original to shard-driftwood's blocking source
suite, test/ci21-candidate/captain-encounter-script.test.ts.

Remove that migrated source from engine's text-inspection list.
The remaining five local scenarios and both gate-selection controls
still run. The original encounter cases remain owned by Driftwood,
as engine test/engine-lift-disposition.json already records.
