# Known reds and the gate before the lock

> Written by: Claude (mini-push2, Mac mini)

- Mini coordinator, ~17:50 Cancún: main went red and ~12 main-push runs
  queued behind one lock, each failing its split gate on the same reds
  and each holding the lock for a 4-minute gate. One run also slept 5
  minutes inside the lock, retrying past another lane's dirty file.
- `scripts/push-known-red.mjs`: when the split gate's Vitest step is
  red, its failing test ids are compared with the same files on
  origin/main (run once in a clean copy of main, cached per main SHA in
  `.git/known-red/`). A red main shares is printed and passes; only a
  NEW red refuses. Vitest runs beside the static lane so a red does not
  stop it. A push that passed on known reds records no green proof.
  `WS_KNOWN_RED=0` turns it off.
- `scripts/main-push.mjs` now syncs and commits under the lock, runs
  the pre-push with the lock free, marks the gated commits by patch id
  (`scripts/main-push-gated.mjs`), then pushes under the lock with
  `WS_MAIN_PUSH_GATED=1`; the push lane skips its gate when every
  outgoing commit carries a mark. Retry waits release the lock.
  `WS_MAIN_PUSH_PREGATE=0` gates under the lock as before.
- Test: `test/tooling/push-known-red.test.mjs` (ids, cache, patch ids
  surviving a replay; a carried ungated commit keeps the gate).
