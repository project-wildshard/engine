> Written by: Claude (opus-grid)

# 2026-11-24: a full pack store reclaims itself before a publish (J505)

Jake, 2026-11-23 ~20:40 Cancún: *"make it a permanent fix ... No queues. No freezing, no waiting."* On 11-23 the 4 GB
pack store (J89) refused Sky Reach r8's cook ("Over the pack budget") until codex-ms previewed and ran a protected GC by
hand (3297 objects, 768 MB; `cook-worker gc` alone keeps only listed builds).

`reclaimPacks` (src/cook/game/cookWorker.ts) is that collection in code: the kept builds whole (`collectGarbage`'s rules:
indexes, what they name, server books and their parts; never a content set, nothing younger than the grace), plus, from
any build, the index of every protected head hash and every key it names. `cook-worker.mjs` lends it as the worker's
`reclaim`: this build, every build a channel carries (`liveDeployBuilds`) and every live, staging and preview head from
the public and pending catalogues. A publish whose write would leave under 15% of the budget free (`needsReclaim`) runs
it first and logs the freed bytes; the serve loop runs it nightly; `cook-worker.mjs reclaim` runs it by hand.
Test: `test/cook-gc-protected.test.ts`.
