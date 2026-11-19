# A return visit's road waits on a cache read that never answers (QA 11-19 row 13)

> Written by: Claude (opus-tr4b8)

Staging v0.1.50 in headless Chromium, Brasscap from Zone Select: the first visit reached control in 10.8 s; the return
visit (a new tab, same profile) sat in `road` for good, "No reported progress for 54.6 s · Now working on: Road system".
The local preview (engine 54fb20eaf) did the same on 3 of about 25 return visits: instrumented, 11 of 300 road tile
persists were stuck in the "already stored?" read (`storedRoadTile`, Cache Storage match plus a byte read), while the
same page's Cache Storage still listed, matched and put. Hosted T1's warm second boots show the worker's copy of it:
`road` 7.4 to 7.7 s, the capture worker's 8 s reply deadline (I and H, runs 44596651357 and 44597665378).

The read is only a shortcut (skip a put of bytes already there), so `persistEncodedRoadTile` now gives it 3 s
(`STORED_READ_DEADLINE_MS`); a tile it cannot confirm in time is put again, as on a first visit. Why the read never
answers is not found: it did not recur in 54 instrumented visits after the rebuild, so it is timing-bound.

Mossgate itself (row 13's zone) is not on staging's Zone Select (v0.1.50: six cards, eight in developer mode), so the
numbers here are Brasscap's on the same path.
