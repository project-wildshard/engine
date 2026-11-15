# opus-of18: OFFLINE OF18 and MMO-FAILURE-MODES leftovers (2026-11-15)

- OF18 closed with no engine change: `fa24ecfc` is in v0.1.20; real-staging `offline-proof.mjs --real` offline and slow are
  4 of 4 green (Driftwood, Nalati, Pine, Night Market).
- Mode 23: the new-build Reload landed on the title. Cause: `online.js` is its own bundle and its saves have no storage, so
  the shell's `setTitleArrival` and `markUnload` were written nowhere and the next page read a "player reload". The page now
  lends `startOnline` a `leaving` port (clientWorker.ts `onlineLeaving`) for arrival, unload, the stale reloads and settle.
  The same loss hit Play here / Play again, `regrid`, `elsewhere` and the release page's Title screen.
- Mode 22: the chaos proxy keeps a socket's frames in order, so ±200 ms jitter on a 60 Hz stream queues every frame behind
  the slowest and the pong RTT sits flat; no chip could show. The proof now swings the downstream delay 20/420 ms every 2.5 s.
- Mode 1 (and 2) on WebKit: Playwright's WebKit `setOffline` leaves loopback sockets up; the proof also cuts the world door
  at the proxy there (`loopbackCut` in the receipt). Both pass in WebKit now.
