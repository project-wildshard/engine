# 2026-11-17 a race resets its middle gates (opus-ss10f)

A race's finish lowered only its start and stop flags. Mirror Salt's arch
line has seven gates between them, each a region trigger that fires only
once the gate before it has, so after one finish their flags stayed up
and a second run could go from the GO line straight to the finish arch;
its quest steps never counted again.

Format 0.19.0 lets a race row name `resets`. `DeclaredQuests` now lowers
the start, the stop and every reset flag at a finish and at a lapse
(`lowerRun`). `test/quest-races.test.ts` failed first (SHARD-SOURCE
SS-MS1c).
