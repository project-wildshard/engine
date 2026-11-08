# Publish the engine test candidates

Status: blocked 2026-11-07: engine v0.1.1 is not yet visible.

The code and seven source cleanups are prepared on main in cache
clones. The 283 decisions are in `test/engine-lift-disposition.json`:
43 migrated files and 240 J186 removals. Named engine proofs passed
149 cases; the remaining shard suites passed 121 files / 296 cases.

Publication is held by Jake's explicit condition: observe engine
`refs/tags/v0.1.1` with `git ls-remote --tags` before pushing anything.
The corrected whole check waited five minutes for the release lane
and timed out without starting. Nothing has been pushed by this job.
The prepared work now includes upstream db17776 and its save epoch;
all 43 migrated files / 149 cases pass again on that code.

| Step | Remaining work | Done when |
| --- | --- | --- |
| 1 | Observe v0.1.1, fetch main/tags and integrate any incoming engine changes; refresh dependencies/pins if changed | The release is visible and the local main includes it |
| 2 | Publish engine through the secrets gate, with SSH keepalives and authorized `WS_FULL_SUITE=1` | The corrected whole pre-push suite passes and the commit is on origin/main |
| 3 | Publish shard-dunes: 5 migrated, 2 deleted | Its pending list is empty on origin/main and its hooks pass |
| 4 | Publish shard-sky-reach: 1 migrated, 9 deleted | Its pending list is empty on origin/main and its hooks pass |
| 5 | Publish shard-driftwood: 8 migrated, 59 deleted | Its pending list is empty on origin/main and its hooks pass |
| 6 | Publish shard-nine-dragon: 3 migrated, 20 deleted | Its pending list is empty on origin/main and its hooks pass |
| 7 | Publish shard-pine-hollow: 16 migrated, 48 deleted | Its pending list is empty on origin/main and its hooks pass |
| 8 | Publish shard-nalati: 9 migrated, 99 deleted | Its pending list is empty on origin/main and its hooks pass |
| 9 | Publish shard-open-plots: 1 migrated, 3 deleted | Its pending list is empty on origin/main and its hooks pass |
| 10 | Record the actual hashes and CI results; close the receipts when publication lands | The requested external report states the actual outcome |

Use the keepalive command in the lift handoff. Never skip checks or
verification. The original whole run found only the real-time seam
timeout; that case now uses the existing server tick proof port and
passes at 71 ms under load. The corrected 13-case network file and
typechecking passed. Engine's pre-existing pending list is unchanged.
