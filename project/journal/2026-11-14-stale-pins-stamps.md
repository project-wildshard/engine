# gen:inputs refuses stale pin output (buddy-engine)

- opus-rel19's report: lands kept re-adding 21 boot-stamp rows (Far
  Reach's `/assets/gpu/far-reach/` hd models) that later pushes dropped.
- Cause: gen:inputs stamps `public/`, where `pnpm pins` publishes each
  pinned product's mounts. A tree installed before a pin bump keeps the
  old revision's mounts; land rebases it onto main and runs gen:inputs,
  which stamped those old files and committed them as "regenerate boot
  stamps". The canonical checkout itself was stale too (pins last run
  Nov 13 18:13: Far Reach rev 1, Driftwood 3, Pine 4, `_template` 3),
  and two worktrees (`ls8-trim`, `te2e`) still are against main.
- Fix: `stalePinProducts(root)` (pins-reuse.mjs) names every `out/`
  product whose `validation.json` pin the pins file no longer names;
  gen.ts refuses to write the bytes table while any exists and says to
  run `pnpm pins`. So a land from a stale worktree stops with that fix
  instead of committing old rows, and a pre-push gate copy does too.
- Canonical: `pnpm pins` (reused from a current worktree in 2 s), now
  Far Reach rev 3; gen:inputs there leaves bytes.generated.ts unchanged.
- Test: `test/stale-pins.test.ts`.
