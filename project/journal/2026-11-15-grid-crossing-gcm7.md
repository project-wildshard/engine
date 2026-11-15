# Grid crossing, opus-gcm7 (2026-11-15 Cancún)

- GC6's "first walk into Nalati waits ~9 s on the road" does not reproduce on a quiet box. On the Mac mini (load 2 to 4),
  local build `fcd4775c` at 2992x1434@2 with 40 ms latency, `--in=50`: 2 of 2 walks reached control with 0 ms of wall
  (Nalati's hooks ran in ~3.3 s on the road, which takes ~14 s to walk). On the laptop at load 8 the same walk held 0.1 s;
  at load 21 to 34 (other lanes' tsc and lint) the hooks ran 10x slower and held. The 9 s was CPU contention, not code.
  Measure crossings on the mini (`~/wildshard-grid/run` there: a copied `dist` + the crossing scripts + Playwright).
- A `--cold` walk (no HTTP cache) held 65 s: the far ring re-reads ~15 shards' sections about once a second, and with the
  cache off on a loopback HTTP/1.1 server those re-reads take every connection. Real pages keep their HTTP cache.
- Pine on the mini: 1 of 2 walks held 17 s on the road, its own world hook 27.5 s (scene library intake 12 s, crags
  6.5 s) with the page pinned at the 1200 MB desktop envelope; the other walk's hook took 2 s with ~70 MB of headroom.
- GC13: the pre-warm beside the source (G723) checked the shared 1.8 GB loading cap on a phone too, so both worlds sat
  on the road at 1.28 GB. The allocator now has a loading envelope; a phone's is its 1.0 GB playing envelope.
- Road lag (Jake 11-15, "Last time I tried going to the road, there was a lot of lag"; continuous crossing dropped, J352,
  ZONE-ENTRY). `scripts/grid-road-lag.mjs` steps 12 m out of a home cell's road-facing entryway and back, by real
  input, and reads every frame from 1 s before to 3 s after each line, any card and the longest stop. Local build on the
  mini at 2992x1434@2: frames stay at 16.7 ms p95 both ways (one 167 ms and one 300 ms frame on the way back in), but from
  Nalati the step out showed a 2.4 to 2.55 s "Region world" card on the road and the step back an "Entry warm-up" card and a
  hold: facing Driftwood's mouth, the road built Driftwood's world and retired the home kept behind. The road now keeps the
  home (last-cell retention) and builds a neighbour's world only at its wall.
- ZE2 (no stop at the home edge). The walk's stops at the lines were the page's own transfer fences: online the page's
  crossing commits when the server's site changes, a round trip after the feet pass the server's 10 m leave or 6 m enter
  line, and the fences stood at 10.1 m and 5.9 m, so the feet waited there (a collider probe on the stall found the
  entry fence at 5.67 m). The fences now stand at 20 m (the cell's own strip is 23.75 m) and 1 m, and the feet walk on
  while the commit lands. Nalati on the mini's preview: out stops 97 to 210 ms before, 48 to 101 ms after. Two holds
  are left and are the server's: the walk back in stops at the server road's own cell wall (2 m out, `roadWorld.ts`)
  while the server reloads the home its GC5 road warm evicted (standalone keeps 1 resident), and Driftwood's step out
  still stands 150 to 340 ms at 10.4 m.
- The server's two holds, measured with probe builds on the mini (not committed). With the server's GC5 road warm off
  (`room.ts` `warm`), Driftwood's walk back in stops 55 to 57 ms (98 to 349 ms with it): the warm opens the cell ahead,
  standalone keeps one resident, so the home is evicted and rebuilt behind the server road's wall. ZE1 deletes the warm.
  Driftwood's step out stands while the server checkpoints the home it leaves: `capture` (the whole cell's snapshot,
  synchronous) takes 122 to 134 ms in the in-page server, and the page's fixed steps stop with it (the motion tick
  stands still for ~150 ms at 10.4 m), so the stop is 150 to 340 ms. Nalati's smaller world: 48 to 101 ms.
- Phone layout (Chromium with Playwright's iPhone 15 Pro; the mini's headless WebKit times out at launch): the first
  lap has one 166 to 417 ms frame at the edge each way (2 of 4 legs), the second lap none; stops 62 to 432 ms. That
  first-lap edge frame is ZE2's other half (the home's interior and tiles admitted on the edge frame).
- ZE2 (opus-gcm8): the in-page server no longer captures a cell's whole world at the step onto the road. The world left
  stays resident with all it holds, so its capture is owed and taken at its eviction (parking the owner's seat for the
  capsule a capture reads); progress saves still write a cell as its progress moves. A reload while on the road loses only
  what moved in the cell since its last progress save. `test/grid-leave-owed-capture.test.ts`, red first.
- ZE5 (opus-gcm8): the page walls every cell but its home with `zoneWalls.ts`: the edge line, open at the four entryways, a
  10 m buffer with its two sides and the gate. They replace the 5 m-out neighbour readiness edges in the session's road
  physics and the look; the hex look now shows at any distance (faint past 70 m). `readinessEdges.ts` is left only for the
  continuous-crossing tests ZE1 retires. The server's road (ZE6) is Codex's.
- ZE8 (opus-gcm8): `bufferAt` (zoneWalls.ts) finds the walled cell whose 8 x 10 m buffer the feet stand in, `GateCount`
  counts 5 to 0 once a second and fires once, and `GateCard` pins a Shard Select-style DOM card to the gate's face through
  the camera. The session fires `host.enterZone` at 0; ZE10 wires it to the loading screen.
- ZE3 (opus-gcm8): `scripts/road-drive-proof.mjs` drives every segment of the junction lattice (60 of 60 in 80 steps: every
  row, every column, outer ring included) with the run key held, steering in the page to waypoints that keep 10 m off each
  roundabout's island, then walks back into the home. A 3-segment check from Driftwood on the mini (build `58bf1ea3`):
  7.2 m/s, 0 frames over 50 ms, stops 54-101 ms, no card, but the page held Nalati and then nothing: the home is retired
  on the road (`playingMB` touched the 1200 MB desktop envelope beside Nalati). ZE1's one-home path is what fixes that;
  the whole drive (about 45 km, ~105 min at 7.2 m/s) runs on the mini once ZE1 lands.
- ZE10 (opus-gcm8), first form: the gate's 0 calls `enterZone` (pageEntry.ts), which paints the full loading screen at once
  and enters the target as Shard select does: a fresh page whose home is the target (its walls move with it) and a goto that
  asks the world, or preview's in-page server (J311), to seat it there. This is the plan's marked-reload fallback, taken first:
  one world in memory by construction. It arrives at the cell's spawn, not 14 m past the gate (ZE9 and ZE11 bring the pose).
  `zone-gate-proof.mjs` shoots the wall, the card at 5 and 2, gone after backing away, and 5 again.
- 12:57 (opus-gcm8) ZE5's wall test drives in at the board's 120 m/s too, and the 40 m fall now meets the wall 19 m up, so a
  2 m wall turns it red. zone-gate-proof shoots on the count, not on sleeps: a slow walk had let 0 fire mid-proof. On a
  loopback build, desktop, phone Chromium and phone WebKit all pass 5, out and reset, 5, 2, and at 0 the loading screen and
  Nalati as the new home. The mini is off limits now (J356), so these ran on the laptop at 60 fps.
- 14:40 (opus-gcm9) Rebased onto ZE1 (main `3c7ff774`). Road-lag on the laptop at 60 fps: Driftwood and Nalati hold the bar
  after the first lap; Pine's walk back in cost 100 to 650 ms frames every lap. Two causes, both on the edge frame: three
  released and relinked material programs (the edge swaps lights and kit, so each side's programs are now pinned by the
  G580 keeper as the feet leave it), and the cell clip walked every forest copy's exact box when the forest re-chose its
  copies (`computeBoundingBox`, 46 to 75 ms): each copy's sphere now settles it, and only a crossing copy is boxed exactly.
