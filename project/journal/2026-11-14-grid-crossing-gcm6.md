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
- The real waste: the per-crossing fetch log showed far-reach's, pine-hollow's and nine-dragon's whole products (descriptor
  and every section) and their near bakes read 4 to 12 times each during the entry window. A page at its envelope refuses
  them; the refusal was keyed on the allocator's revision, which every claim anywhere moves, so each was read, parsed and
  refused again many times a second. `BudgetDeferrals` retries a refused optional read only once room was freed or 3 s
  passed (the cell ahead's demand read keeps the revision rule).
- GC13: the phone tier's allocator admits against G65's 1.0 GB (`PHONE_PLAYING_BYTES`), not the shared caps' 1.2 GB
  Explorer figure, and last-cell retention reads the allocator's envelope.
