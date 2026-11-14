# Grid crossing, opus-gcm4 (2026-11-13 night Cancún)

- GC3's cold-cache pass: within one tour the HTTP cache and the service worker make every later crossing warm, so `--cold` turns
  both off in each page (Chromium's DevTools cache switch; WebKit blocks service workers only) and the stages table reads such a
  tour as all cold.
- GC13, the server half: short of workers, `workerTable` let the last row keep every unnamed cell. Staging's 2 workers held Nalati
  alone and the other 25 cells together (its road walled Nalati off Driftwood until GC15's between-worker move), production's 4
  held 23 on one. The unnamed cells now move from that row to the rows holding fewest, so no worker holds more than its share
  plus one. A first cut spread every cell, which moved Sunscar and Sky Reach off Driftwood's worker; named cells now keep their
  worker, so Driftwood's working exits stay on one worker and only open plots and templates cross between workers (GC15).
- GC17: `scripts/grid-crossing-nightly.mjs`, called hourly, runs the staging walks when staging's release serial is new and the
  every-pair preview tour once a night, writes the report, checks the ratchet and appends a `grid-nightly` receipt. The tour's
  `--hold` stands in each cell reached and records when the cell behind let its world go (`fromEvictedMs`) and the page's peak
  playing cost, for GC13's straight walk.
- Tour types: the probe's `target`, the prepare window's tuple and the page handle now typecheck (the commit lane read them).
