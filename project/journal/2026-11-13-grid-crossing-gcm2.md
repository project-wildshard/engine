# Grid crossing, every pair (opus-gcm2)

- GC2: the breach matrix's last cases. `test/grid-wall-breach.test.ts` throws a fall from 12 m, a fall from the wall's 60 m
  top and a sprint along it at the server's road wall in front of a walled cell (Far Reach): all hold. The walk proof's
  `--breach` now also runs at the page's loading wall (preview Pine while it prepares), and stops when the wall opens, since
  entering a ready neighbour is the crossing working.
- GC4: since J320 every cell is resident from the worker's boot and sleep is only not ticking, so the one boot left on a
  crossing was a start-over (J107): a walker who stepped onto the road and turned back met Driftwood booting again at the
  line. `cellHost.ts` now defers a start-over while anyone on the worker's road stands within 40 m of that cell's edge
  (`RoadRoom.near`), and looks again every 5 s. `test/dedicated-start-over-near.test.ts`, red first.
- GC7: the page's readiness wall gets GC2's cases as a physics test (`grid-readiness-wall-breach.test.ts`): walk, boost at
  18 m/s, jump, a fall from 40 m and a slide along it, all four sides, held while closed and through once ready. Red under
  a 2 m wall and under a wall that never opens.
- GC15 (3), the between-worker move. A seat on one worker's road now walks into a cell another worker hosts on the same
  socket: the door reads the save there, the road sends `travel` and lets the seat go (`RoadRoom.handOut`, `NetRoom.handOut`),
  its port says `out` with the walker's motion after everything else it sent, and the door points the socket at a new port
  into the target worker (`arrive`), whose room seats the body at the arrival pose and hears the client's hello again, as a
  travel's welcome. Each worker's `booted` names its cells whose entryways stand; the door tells the other roads (`open`),
  which drop their walls round them. `test/dedicated-cross-worker.test.ts`: Driftwood to Nalati on the other worker and back,
  no redial; red with the roads left walled.
- GC8, first half: the grid's state names the `cell` step the loading screen shows now (`cellStep`, from `CellLoading.now`),
  and the walk proof and the tour sample it, so each step's time on screen is measured per crossing once preview and
  staging serve this build. Before, the state named only the waiting cell.
- GC15 review (one-shot `claude -p`): a seat whose socket closes mid-move now clears its `outs` entry and abandons the
  crossing, and a worker that drains while a seat moves out closes it with `restart` so the client redials. The target
  builds the seat's transport only once the room has settled, refuses cleanly if it never does, and holds off a start-over
  while an arrival is in flight. `NetRoom.travelled` resets the ledger it has seen, so the new room sends the arrival a full
  ledger. Not fixed: input the client sends between the road's `travel` and the door's re-pump is dropped (a few frames).
- GC3 tooling: `scripts/grid-crossing-tour.mjs` walks every neighbouring pair in one page on a live site. It places the
  walker 238 m into the source cell, walks (toward +x/+z) or boosts (toward -x/-z) across, records border-to-control, the
  wall, the freeze, frames over 50 ms, memory and the loading steps per crossing, and repeats over good arcs to reach the
  next untried one; a stranded walker re-enters by the title with a fresh profile. `scripts/grid-crossing-report.mjs`
  turns runs into one page with thumbnails and holds them to `test/grid-crossing-ratchet.json`
  (`scripts/grid-crossing-ratchet.mjs`: a pair may not get worse past its slack; `--tighten` lowers the bar). First
  preview read: Chromium desktop, run beside WebKit, held 73 s on the road into Nalati and never reached control.
- GC3 first report (preview, WebKit phone, 56 crossings, 52 reached control): border-to-control median 103 ms, but 13
  crossings were held at the neighbour's loading wall for 0.1 to 7.6 s, most of them boosts (the page's warm-up starts too
  late at 18 m/s: GC5). Every walk out of Far Reach falls, since its entryway has no ground. The ratchet is seeded from it.
  The tour now writes its JSON after every crossing (this run hit its 90 min limit before writing and was read back from the
  log), and the report reads one 100 ms sample as the floor of a stop, not a stop.
