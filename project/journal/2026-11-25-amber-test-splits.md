# Three AMBER test files back under 60 s (opus-amber, meta QA 11-25 row 33)

- main-watch logged three files over the 60 s file budget (J295): cook-worker-publish 63 to 66 s, native-assembly-host-
  sections 62 to 64 s, cook-recook-rule 62 to 68 s. Same tests, same assertions, no budget moved.
- cook-recook-rule: the time was bake-loader, not the recook rule. Its counting job is plain JavaScript, yet each of
  the 58 launches paid about 0.2 s for the TypeScript hooks. An empty loader in scratch keeps the `--import` boundary;
  the file went from 20 s of tests to 2.4 s locally.
- cook-worker-publish: six real Sunscar cooks, one cold (9.6 s) and five warm (3 s). Split in three (publish,
  publish-budget, publish-full), each paying its own cold cook, each in its own CI native group and the cook CPU grant.
- native-assembly-host-sections: split per pinned shard, plus Nalati's fold (the slowest proof) on its own; the proofs
  and helpers live in test/fixtures/nativeHostSections.ts. The old file ran 4.3x slower on CI than idle locally, mostly
  contention with sibling workers, so smaller files buy the headroom.
- The engine worktree cap was full (10 of 10), so this went through engine-quickfix and main-push.
