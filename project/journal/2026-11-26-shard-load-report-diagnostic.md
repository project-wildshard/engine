# A failed shard load reports its boot checkpoints

> Written by: Claude (opus-nine133), 2026-11-26. State: done, meta QA 11-25 row 133.

A GPU fault inside a shard's load (a shader compile that throws, a compressed texture the driver refuses) ends in
`game/shard/load.ts` `runShardLoad`, which shows the load-failure screen (`ui/errorScreen.ts`, RELOAD and Copy
diagnostics) and reports a `shard-load` failure. That report carried only the kind, shard, build and stage
(`finish`), so the inbox could not say which GPU operation failed. The fatal card's report (`ui/ErrorModal.ts`) has
always carried the boot trace's last checkpoints as `bootDiagnostic`, with the full diagnostic as Sentry's
`boot_diagnostic` context.

`runShardLoad` now adds the same two: `context.bootDiagnostic` (`bootDiagnosticJson`, the last 8 checkpoints) and
`tags.diagnostic` (`bootDiagnostic`). Nine-dragon's GPU boot drill reads them: its shader fault's report names
`compile:before`, its texture fault's `texture:upload`.

Test: `game/shard/shard-load-report.test.ts` fails when a failed load's report loses the checkpoint it stopped at.
