# DL21: the coarse cover beside the spawn tiles, and staged world parts on the card

> Written by: Claude

DL21 fails a loading card unchanged for a second. After opus-gaps' fixes (`fd8593d`) two of the named holds had a cause
that could be read off the iPhone Simulator's own records (drive runs with the service worker's per-request phases
dumped from the page's boot timing, engine main `479c206`, Mac load 15-20 with the Simulator running).

## Nine warm: 'Spawn tiles 9 / 9 · coarse cover' for 1.0 s

Every warm Nine run on packs reads its kit's files through the service worker. The coarse cover (the whole-refinement
L1 parents beyond the spawn ring) starts after the nine spawn tiles, about 2 s after the last service-worker read, and its
first read took 1,000-1,006 ms on 9 of 12 warm runs across four builds (opus-dl's `b17d8b7`, `ef213f2`, `57cb6f6`,
opus-gaps' `fd8593d`, and this lane's two probes). Always the same file, a graph material JSON the boot had already read
twice, fast, at 2 s. The worker's own phases for that request: handler 0 ms, `caches.open` 0 ms (its handle was hot),
`cache.match` 1,001 ms, a hit. So it is WebKit's Cache Storage, not a network wait or a worker restart (MF10's earlier
reading was a 1 s `caches.open`; this one is a match on an open cache; the 3 fast runs had the same ~2 s without a read, so what triggers it is
WebKit's). The cover's other reads took 1-3 ms each; 85 of its 97 reads re-read bytes the boot had already read.

The page cannot make WebKit answer faster without a second copy of the bytes (the service worker's design keeps no
body memo and no timers, and `ClientAssets` keeps no settled read by design, js-heap H6). It can stop waiting on it alone:
the cover now starts once the arrival tile is attached, beside the other eight spawn tiles, whose count moves the card
meanwhile. Publication still waits for both; a failed spawn tile still refuses the boot, once the cover has settled, so
no cover work outlives a refused boot. On a cold load the cover's reads come from the packs already in memory, and in
a Shardfile-mode cold load they start only after the arrival tile (H3's rule for the entered-tile streamer: the
arrival first, then the rest together).

## Pine warm: 'Region world · world data' for 1.0 s

A staged world's `progress` is the no-op of `session.ts`: its world hook is no plan step of its own. So inside the
'world data' span (796 ms on that run, then the forest page) the card showed only the span's name while the library,
materials, looks, item models and skins finished one by one. `worldStep` now also reports each part on the current
loading step ('World data 3 / 10 · looks'); the span's restore keeps a step's own report, so the last part stays until
the next span names itself.

## Not fixed here, read on the same runs

- Nine cold First frame: one or two frames of 466-505 ms in the parked warm with no link (62 programs throughout). The
  Simulator link probe (`link-probe.mjs`) puts Nine's architecture graph programs at 586-635 ms each to link cold (155 KB
  fragment shaders from 2,131-node graphs); the parked draw is where Metal builds each one's pipeline, and the warm
  already narrows to one new material a slice after a 400 ms slice. One pipeline per frame is the floor while the
  shader is that size.
- Driftwood cold Shaders link waits: its graph programs link in 458-507 ms each at this load (100 KB fragments), the
  first link of a fresh GPU process 1,113 ms. The count moves at every landed link; a second without one is a single
  link stretched past 1 s by load.

Tests, in existing files: the cover starts after the arrival tile and before the second spawn tile, gates publication,
and a failure beside a running cover refuses only after it settles (`tile-driver.test.ts`, two existing tests updated
for the cover now being asked once on such a boot); a staged world's parts name themselves under the span
(`client-preparation-timing.test.ts`, fails without the report).
