# GC2: the online cell rim (opus-gc2)

- GRID-CROSSING GC2, staging v0.1.12. Cause of the first repro's "invisible wall, then a frozen page": the MMO server still
  walls each cell (`dedicatedRoom.ts` opens it `lone`, C5; `addEdgeWalls`, inner face 0.8 m inside the edge), and the page
  predicts with no wall, so at boost its feet ran up to ~6 m onto the rim (z −256) before the server pulled them back. The
  page's `session.ts` step read that as leaving the cell: `gridCells.leave()` dropped the entered hooks (the 900 ms frame).
  Turning back, `liveSession.gameplayReady()` went false (feet in the interior, hooks not entered), `play.ts`'s frame gate
  shut, and the fixed step that would `gridCells.enter` never ran again: 120 s with the page "on the road" and no frame.
  A walk (4.3 m/s) stops at z −249.8 and never leaves, so only boost showed it.
- Fix: `cellPresence.ts`. On a wire, feet off every interior while the server still holds the body in the current cell keep
  it entered; the frame gate (`LiveGridSession.frameReady`) enters the current cell itself when the feet are back inside it
  with its hooks never entered. Real online crossings stay MP1.6 / GC15.
