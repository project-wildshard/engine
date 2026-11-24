# Zone-snapshot guard (ZONE-SNAPSHOTS ZS1)

> Written by: Claude (lane opus-snap). 2026-11-24.

Jake (J507): no old zone snapshots in test suites; delete or upgrade them. Before deleting, a guard so no new one
comes in. `scripts/zone-snapshot-guard.mjs` runs inside `lint:game`'s full-tree pass (so `pnpm check`, the push
gate's static lane and CI all run it). It refuses a pin record outside `test/pins/`, an old-format or zone-named
`shard.json`, a `<zone>-r<N>` path and frozen extracts or lift originals. Today's 302 offenders sit in a shrink-only
baseline; ZS7 to ZS10 take it to zero, and `--prune` drops entries once their files are gone.
