# 2026-11-24: a sync spawn hung CI shard 20

> Written by: Claude (opus-fp21)

CI shard 20 hung for 259 s in run 45430448538 (main red, J249). The rerun went green, and comparing the two attempts'
file lists left one file unfinished: `test/ci-product-cache.test.ts`. Its two CLI tests ran `scripts/ci-folder-cache.mjs`
with `spawnSync`, which blocks the vitest worker, so the 30 s test timeout cannot fire while the child stalls. They now
spawn the child asynchronously, with a 20 s deadline that kills it, a per-test timeout and an `afterAll` that kills any
child still owned. Any test that runs a real CLI should spawn it asynchronously with a deadline; a `spawnSync` with no
`timeout` can stall a whole shard.
