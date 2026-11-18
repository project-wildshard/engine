# The singleplayer push-loop chain is gone (meta FLOW-SIMPLE FS9, opus-flow2)

`sp-tools.py` ran a pane-owned push cadence (`push-loop.py`, which ran `live-prepush.py`) and `lane-watchdog.mjs`, from
singleplayer's one-checkout era (G582). Nothing in engine starts any of them; J422's push gate and main-watch replaced
the cadence and the watchdog. Deleted: the six scripts and their two tests, 2,103 lines.

The re-check had found three referrers; none needed the chain. `precommit-source.py` added
`vitest-push-guards.config.ts` as a root, but that file was already deleted and missing roots are skipped;
`scripts/tsconfig.json` listed both deleted push configs; `test/shared-worker-tests.json` listed the watchdog test.
`check-paths.allow.json` loses its four `live-prepush.py` entries and `push-inputs.mjs` a missing test name.
`sim-quiet.py` keeps taking `push-loop.lock`: only the lock's name came from the chain.
