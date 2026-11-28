# 2026-11-28: a full push gate no longer runs fewer tests

- Main went red at 0c3e3df8c (meta QA 11-26 row 87). Row 80's `grantLoopback` calls `page.context().grantPermissions`,
  and the Playwright fakes in `test/nine-load.test.ts` and `test/phone-frame-budgets.test.ts` had neither. Both fakes
  now grant, and both tests assert the grant names the page's own origin.
- Why the push gate let it through: the push changed `zone-entry.mjs`, which both tests import, and
  `phone-memory-card-proof.mjs`, which no test imports. `completePushSelection` saw zero tests for the script and
  returned "full". The complete local gate runs everything on full, but the split gate (every main push) runs only the
  declared native files on full. So a push with one untested script ran fewer tests than one without it.
- Guard: a full fallback now keeps checking every changed module and carries the tests it found. `splitLocalTests`
  runs those beside the native files. `test/gate-related-tests.test.ts` holds both halves with 0c3e3df8c's shape.
- The second red (meta QA 11-26 row 88) is the same hole from another side. engine 85f353419 pinned shard-format
  0.82.9, which admits only `title` from the engine style (SF23). `test/boot-audio-packs.test.ts` still played island
  and pine from base; its fixture now carries them as its own set. A package.json change always runs full, so the gate
  ran native files only. `src/scripts/push-dependency-readers.mjs` now diffs the old and new copies of each bumped
  package (both sit in the pnpm store), walks the package's own imports out from the changed files, and the split gate
  runs the Vitest files that import the nearest changed entry points by name, up to 80 files. For 0.82.9 that is 17
  files, boot-audio-packs among them. No old copy to diff means every direct reader of the package.
