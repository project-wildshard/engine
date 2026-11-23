# OF31h4: the engine keeps no table of shards' costs

> Written by: Claude (opus-of-close3), 2026-11-22

`workerTable.ts` loses `COST`, `COSTS_MEASURED` and `TOGETHER`: a cell weighs what its shard declares (`admission.serverBudget.awakeMicros`, OF31h2) and shares a worker only by its own `shareWorker`; an undeclared cell weighs as an Open Plot. The table tests carry the shards' declared numbers as a fixture, and `roomBench` reads each cell's pinned `shard.json` the way the box does. Built ahead: it lands once OF31h3's cost rows are pinned (until then `dedicated-cross-worker-cells` puts Driftwood and Nalati on one worker).
