# Grid crossing, opus-gcm6 (2026-11-14 night Cancún)

- GC6's last piece, the first walk into Nalati waiting on the road for its entry preparation (opus-gcm5 measured 9 s).
  Local build at Jake's 2992x1434@2 with 40 ms added to every request (`grid-crossing-tour.mjs --latency=40`), 3 tours:
  that preparation took 6.2, 8.8 and 19 s, and the tour's wall missed the 8.7 s hold in the slow one (the crossing waits in
  phase `ready` while an entry prepares; it now counts). A CPU profile of the window (`--profile`) put a fifth of the main
  thread in `loadShardfileNear`: the neighbours' near views load on the road beside the entry, and `applyMatrix4` rebuilt
  bounds the loader had set (two passes per part, ~45 % of that bake). A near part now bakes its pose without bounds (an
  identity pose not at all).
- First try, withdrawn: near view loads (then also speculative product reads) waited while an entry prepared on the road.
  Three sequential tours said 3.5 s; interleaved before/after pairs on a loaded box (load average 25 to 30) said no gain,
  and 2 of 8 "after" tours held 12 to 17 s with Nalati's world hook at 15 to 28 s (the wait's 20 s cap), against 0 of 8
  "before". Interleave before and after; sequential runs on this shared Mac lie.
- Second try, withdrawn too: far-reach's, pine-hollow's and nine-dragon's products and near bakes were read 4 to 12 times
  each in the entry window (a refusal keyed on the allocator revision, which every claim moves). Retrying a refused optional
  read only after freed room or 3 s cut nothing measurable: 5 interleaved pairs, Driftwood to Nalati held 3.9 to 6.9 s in 3
  "after" tours against 1 (5.2 s) "before"; the same radial read covers the cell ahead, so a backoff can delay it.
- What is left, for the next owner: the on-road preparation is mostly Nalati's own hooks on a first visit (world 1.5 to
  2.7 s, afterKit 0.5 to 4 s, play 3 to 8 s, from the grid probe's `hookTimings`), and the far ring re-reads about 12
  shards' products (descriptor, world sections, bins, all from the HTTP cache) about once a second during it.
- GC13: the phone tier's allocator admits against G65's 1.0 GB (`PHONE_PLAYING_BYTES`), not the shared caps' 1.2 GB
  Explorer figure, and last-cell retention reads the allocator's envelope.
