# land retries a fetch that loses a ref lock (opus-landrace)

- Main run 43332891983 went red on `2d33c963`: `test/land.test.ts` "two worktrees land at once" stopped with
  `git fetch origin main failed: error: cannot lock ref 'refs/remotes/origin/main': is at 67cc4b21 but expected 04ef18ba`.
  Sibling worktrees share `refs/remotes/origin/main`; the land that fetched second lost the ref's lock and stopped. Real
  lanes landing at the same moment hit the same thing.
- `tryGitLocked` in `scripts/land.mjs` retries a git command up to 4 times (200/400/800/1600 ms plus jitter) while its
  stderr matches `REF_LOCK` (`cannot lock ref`, or `Unable to create '...lock': File exists`). Used for every fetch land
  makes (main, its plan branch, the canonical checkout's follow) and the two `update-ref -d` calls. Anything else stops
  as before. Each retry prints a `land ... retry` line.
- Pushes are not retried: when only git's local tracking-ref update loses the lock after a push, git prints an error
  and still exits 0.
- From the review: `pushPlan` used to delete its tracking ref on any fetch failure, so a network error read as
  "origin moved, someone else pushed". It now clears it only on `couldn't find remote ref` and stops otherwise.
- Tests, red first on the lock-once shim: a git shim on the fixture PATH fails land's main fetch once with the CI
  message (land retries and lands), always with a lock error (5 fetches, then STOP), or with a network error (1 fetch,
  STOP, no retry); `REF_LOCK` positive and negative cases. The concurrency test passed 20 of 20 runs locally.
- Follow-up, not this unit: `main-watch.mjs`, `worktree.mjs new`, `main-pull.mjs` and `worktree-reap.mjs` fetch the
  same shared ref with no retry.
