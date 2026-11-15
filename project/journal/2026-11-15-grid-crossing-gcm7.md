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
