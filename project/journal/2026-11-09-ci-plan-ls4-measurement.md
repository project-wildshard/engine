# The LS4 file crossed the planner's unmeasured bound

Exact CI 42698447892 at 0cf8d429 and 42699787652 at 299fb0ad fail
before tests, in plan jobs 129436643801 and 129441280709. Ring 1 passes.
The failure is the unchanged requirement for at least 90% gain and
20% headroom below the five-minute shard wall, not an LS4 assertion.

LS4 15786ee (canonical b1dd2e6) introduces
`src/client/engine/ui/load-failure-copy.test.ts`. It has no duration entry,
so the planner correctly charges its conservative sixty-second bound.
Actual full discovery reproduces the refusal: 1178 blocking files,
best twelve-shard model 243.272668 s, over the 240 s headroom target.
Removing only this new file as a diagnostic parent-inventory comparison
gives twelve shards at 239.896194 s. No test was removed from any gate.

The exact green Linux Ring 1 run 42699787431 at 299fb0ad supplies the
measurement: artifact 13710457844 (`ring1-tests-1`),
`shard-1-ordinary.json`, measuredAt 1794258690435, module state passed.
Full module duration is 1050.523957 ms, including collection, setup,
preparation and environment, not just its 23.741296 ms case duration.
This exact pure DOM file uses happy-dom in both rings and reads no
pinned product, so its full module observation applies to both registries.

Only that measured entry and its provenance are added. The other unknown
files retain sixty seconds. No global factor/setup calibration, test,
inventory, native group, cap, assertion or deadline changes. In particular,
nonblocking quarantine 2/3 budget reds remain separately disclosed.
The production UI belongs to the completed Opus LS4 lane; this forward
belongs to codex-mock's CI duration registry.

The unchanged actual planner is green after this data-only forward:
full 1178 files / twelve shards / modeled maximum 239.952366 s;
Ring 1 1096 files / eight shards / 224.315249 s. Both plans validate
exactly-once membership and their actual current commit. The other
eleven/nine unknown files still cost sixty seconds. Hosted CI green
and the complete normal pre-push remain required before closure.
