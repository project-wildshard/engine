# opus-of18: OFFLINE OF18 and MMO-FAILURE-MODES leftovers (2026-11-15)

- OF18 closed with no engine change: `fa24ecfc` is in v0.1.20; real-staging `offline-proof.mjs --real` offline and slow are
  4 of 4 green (Driftwood, Nalati, Pine, Night Market).
- Mode 23: the new-build Reload landed on the title. Cause: `online.js` is its own bundle and its saves have no storage, so
  the shell's `setTitleArrival` and `markUnload` were written nowhere and the next page read a "player reload". The page now
  lends `startOnline` a `leaving` port (clientWorker.ts `onlineLeaving`) for arrival, unload, the stale reloads and settle.
  The same loss hit Play here / Play again, `regrid`, `elsewhere` and the release page's Title screen.
