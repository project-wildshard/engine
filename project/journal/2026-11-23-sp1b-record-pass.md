# SP1b-T: the box cook's record pass is wired

> Written by: Claude (lane opus-prune1)

codex-ms's SP1b-T precheck found `recordCatalogue` and the sidecar reader on main but nothing in the boxed worker's entry
point (`scripts/cook-worker.mjs`) that used them. Now `COOK_SIDECARS` sets `launcher.sidecars` (every job reads its shard's
`<hash>/<renderer>.tar`), and `recook` runs the record pass first (`recordPass`, new `record` command alone): with
`COOK_RECORDER` (the `wildshard` command as JSON), `COOK_PREPARATION_CLIENT` and `COOK_RECORD_CANARY` it records a sidecar for
every stale live, preview and staging head, canary first; missing any, it logs which name and records nothing. The box unit
sets `COOK_SIDECARS=$COOK_HOME/sidecars`; installing the recorder, its WebKit and client on the box stays SP1b-T's box half.
