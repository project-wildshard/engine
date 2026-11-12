# FL27: a quit the door dropped (opus-stall2)

- `test/online-shell.test.ts` "a quit while the link is down and redialling" went red on branch ci 43165862958 (a TS10 strike,
  green on its re-run). The case closed the door's ends `stalled`, slept 50 ms, then quit. On a loaded runner the page had not
  heard the close yet, so `leave()` said the quit on the dropped socket; the door never heard it and held the body for J114's 30 s.
- That is a player path too: a quit in the same moment the door drops a link is lost. `leave()` now says the quit once more on a
  fresh link when its link closes `stalled` (a heard quit closes plainly, 1000 -> `closed`).
- The redial case now waits for the page to report `reconnecting`, so it tests the path it names. A new case plants the race (close
  and quit in one turn): red 3/3 without the fix at the same assertion as CI, green with it.
