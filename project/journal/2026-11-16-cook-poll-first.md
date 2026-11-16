# The cook polls from boot, new uploads first (buddy-engine)

- opus-ss16g: `cook-worker serve` awaited the boot recook of all 33
  heads (about 2 h on the box) before its first poll. Every release
  restarts the cook, so a new upload waited 2 h; its 0.0.3 upload had no
  index after 30 minutes.
- `bootCook` starts the poll and the recook together. The worker's queue
  still cooks one at a time, but in two lines: a hash no build has
  indexed (`index/<build>/<hash>.json`, one `list('index/')` per recook
  or sweep) goes before a known head this build has yet to recook. A
  hash already waiting is never queued twice; asked again as new, it
  moves up.
- `sweep` waits only for the new uploads it found. A known head it finds
  cooks in the background, so a poll that meets a release's recooks
  still looks again in 45 s. Notices and `cook()` count as new.
- The queue starts a microtask after a schedule, so a recook's batch is
  ordered before its first cook.
- Tests, red first: a recook downloads the new upload first; a sweep
  during a recook gets the new upload next and answers once it is done;
  `bootCook` sweeps while the recook never ends. A download that fails
  at once stands in for a cook, so the order of downloads is the order
  of cooks.
