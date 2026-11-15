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
- Mode 36: nothing ever gave up, since a failed content read waits on RETRY forever (pinned on purpose: time never retries).
  Now a read on RETRY becomes the `download-failed` page when the spawn download's job refused (a part out of its three
  reads) or after `DOWNLOAD_GIVE_UP_MS` (30 s) on RETRY with nothing reading again by itself. The count is every read of that
  file so far; Try again is the same RETRY (no new counter), Check connection opens the doctor, Copy diagnostics copies the
  measured failure. The FM3 proof's packs 503 sits on the spawn manifest's own read, so the time bound is what fires there.
- One claude -p review of the branch: no MUST. Fixed its SHOULDs: per-part last status and failure in the give-up fact,
  a read that arrives after RETRY clears the fact, a queued second read takes the page over, the lossy wave stops on every
  path, and a failed heal no longer hides a case's own error.
