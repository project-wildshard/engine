# Measure the new Doctor module before sharding it

Exact published Doctor906dfd5 CI42709242469 fails in plan129474229899,
before tests: no shard count meets 90% gain and 240 s headroom. Static
and e2e pass. The new connection-doctor file has the required conservative
60 s unknown weight. Current actual discovery reproduces the same full
planner refusal; Ring 1 still has a valid plan. The source trigger is
Opus Doctor3a19ab3 (canonical05435fa), not the queue or a test assertion.

Use its real passed Linux Ring 1 module from run42709241950 at906dfd5:
artifact13715591117, shard-1-ordinary.json, ended1794262280637,
11570.329586 ms total including collection6654.948388 ms and all setup/
environment. The cases/hooks alone take4793.522035 ms and are not the
weight. Both rings use the same Node environment, real local HTTP and
WebSocket fixtures, and only the same pinned Driftwood product opened
by roomBench. There is no full-catalogue branch in this file.

Only that measured entry and its provenance change. No test, UI, group,
case/file/shard deadline, 60 s unknown bound, factor1.35/setup70s or
headroom rule changes. The already prepared cook admission/SDK cache/
partial-source forwards are held for this exact planner fix; no new
optional source is added to the capture. Full normal and hosted checks
must pass before main is called green again.
