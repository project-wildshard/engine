# The shared push queue is retired (LAND-SIMPLIFY LS7)

J258, Jake: "Delete them." The queue serialised docs and release pushes
from the canonical checkout through private snapshot clones. Its
preflight went in LS2. Land is the per-worktree queue (J249), and git's
fast-forward rejection handles main races.

- Deleted: `scripts/push-queue.mjs` and its `-rebase`, `-clone`,
  `-admission`, `-lock` and `-retain` helpers (mjs and py), their seven
  proofs, and `test/push-queue-clone.test.ts`.
- `heavy-lane.py` loses the queue owner kind and `queue_identity`, which
  only read queue job records; `full-test-log-proof.py` loses its queue
  section.
- Docs and release pushes from the canonical checkout are a plain
  `git push origin main` through the normal pre-push; its docs-only path
  already skips the suite. `release.sh` already pushed main directly.
- Kept: `push-proof-cache.mjs`, which the full gate still uses.
