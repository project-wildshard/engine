# The chaos proxy passes the door's agent and spawn words

> Written by: Claude (mini-qafix), 2026-11-22. Meta QA-FEEDBACK-2026-11-22 row 7 (FM11 failmodes red).

Since 4900858fc (2026-11-19) an agent page's socket dial carries `?agent=<lane>|1`, and a Zone Select dial `at=spawn`.
The FM3 chaos proxy let only `?chunk=` through to the world door and answered every other query with a 404, so no
FM11 page ever took a seat: the rig logged `players: 0`, `drop` and `drop/blocked` found no socket to fault ("matched
nothing") and `offline-play` had no seat to come back to. The proxy now passes `chunk`, `at=spawn` (with a cell) and a
bounded `agent` marker, each at most once, and still refuses anything else.
