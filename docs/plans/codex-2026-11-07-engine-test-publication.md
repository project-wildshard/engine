# Publish the engine test candidates

Status: publishing 2026-11-08. Release v0.1.1 is visible at 0d9e238.

The code and seven source cleanups are prepared on main in cache
clones. The 283 decisions are in `test/engine-lift-disposition.json`:
43 migrated files and 240 J186 removals. Named engine proofs passed
149 cases; the remaining shard suites passed 121 files / 296 cases.

The release condition was observed with `git ls-remote --tags` at
02:31 UTC on November 8, and rechecked before publication.
The corrected whole check waited five minutes for the release lane
and timed out without starting. Nothing has been pushed by this job.
The prepared work now includes upstream db17776 and its save epoch;
all 43 migrated files / 149 cases pass again on that code.

| Step | Remaining work | Done when |
| --- | --- | --- |
| 1 | Observe v0.1.1, fetch main/tags and integrate any incoming engine changes; refresh dependencies/pins if changed | The release is visible and the local main includes it |
| 2 | Publish engine through the secrets gate, with SSH keepalives and authorized `WS_FULL_SUITE=1` | The corrected whole pre-push suite passes and the commit is on origin/main |
| Review | Add quick actual-play successors for Pine/Nalati resume, Miller payment order, Titan fire, lance cone/rehit and the harbour rack; re-judge the law-test deletion | Five cases pass, each below ten seconds; precise source-based disposition and real-clock explanation are committed |
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

Publication uses the fresh `engine-tests-publish` clone. It contains
only the engine-test chain through 2c2c3cb and its review follow-up.
The original `engine-tests` clone retains SR1-SR3 and the SR4/review
work. Codex-port owns publishing all split repairs together, including
SR7; this lane must never push those commits separately.

Successors use admitted full products on Ring 2. They use actual
interactions, held commands, combat and fresh-host snapshots. Fixtures
provide an already completed Pine errand, an existing Nalati milestone,
positions, ample ammunition and a wolf with enough health to survive
another lance offer. No test emits a kill, hit or quest outcome. The
Titan earns both phase transitions through arrows and support melee.
The longest new case measured 7.41 seconds. The original real-clock
save case now explains its intentional two-second tick wait in place.

Source review found nine pure scalar-law cases and one fabricated
GLTF/Player binding case in held-weapon-laws. The three mock matches
belong only to that last case. Its deletion remains J186 because the
other cases pin projected channels, ABI identity and cadence; the
published gameplay contract now has an actual lance successor.
