# 2026-11-19: the first-paint tests catch up with row 19

Lane: buddy-engine (Coordinator-assigned red, run 44611472919, tests 1 shard 23).

b000479f2 (QA 11-19 row 19, opus-tr4b8, lane ended) changed two things these tests pinned.
- The title shell's line now says what it loads: "Loading the page" before any file, then "Loading
  <file> · n of m files", naming the first file still missing with its hash dropped.
- The 12 s self-reload waits while responses still arrive and reloads only after 4 s of nothing. That
  grew the inline first-paint script from 15 lines to 21.

Both changes are row 19's intent (a slow line on Jake's phone sat on a bare count and reloaded mid-load),
so the code is right and the tests were stale. title-first-paint now expects the named labels, derives
the waiting file's name the way the page does, and caps the inline script at 21 lines with the reason
next to the cap. RL3's reload behaviour (once a session, never for a running boot or the title) is
unchanged and still asserted; the arriving rule is covered by inline-save-epoch.
