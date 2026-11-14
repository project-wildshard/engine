# Grid crossing, opus-gcm6 (2026-11-14 night Cancún)

- GC6's last piece, the first walk into Nalati waiting on the road for its entry preparation (opus-gcm5 measured 9 s).
  Local build at Jake's 2992x1434@2 with 40 ms added to every request (`grid-crossing-tour.mjs --latency=40`), 3 tours:
  that preparation took 6.2, 8.8 and 19 s, and the tour's wall missed the 8.7 s hold in the slow one (the crossing waits in
  phase `ready` while an entry prepares; it now counts). A CPU profile of the window (`--profile`) put a fifth of the main
  thread in `loadShardfileNear`: the neighbours' near views load on the road beside the entry, and `applyMatrix4` rebuilt
  bounds the loader had set (two passes per part, ~45 % of that bake). Their fetches also queued with the entry's reads.
- Near view loads now wait while an entry prepares on the road (`LiveGridSession.entriesPreparing`, 20 s cap; the far proxy
  draws meanwhile), and a near part bakes its pose without bounds (an identity pose not at all). Same setup after: 3.5 to
  3.8 s, the play hooks 2.5 to 4.8 s -> 0.25 to 0.34 s.
