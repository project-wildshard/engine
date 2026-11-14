# Server cells, relay 3 (opus-cells3)

- SC8: each worker reading now says every awake cell's mean tick time (`cellMs`), `/metrics` serves it as
  `wildshard_cell_tick_seconds{cell}`, and `cell-mem-bench.mjs` reports it per cell. One box run (`--remote wildshard-agent
  --counts 25`, release 7251ca24's packs, a bot in each of the 25 cells, 4 workers on staging's cores) gave the costs: Nalati
  2.7 ms a tick, Driftwood 1.8, Pine 1.6, Blender template 1.3, Far Reach 0.9, the Open Plots 0.17 to 0.6; 15.2 ms in all.
- `workerTable` now packs cells by those costs (heaviest first, onto the lightest worker; Sunscar and Far Reach still share).
  Production's 4 workers carry 3.7 to 3.8 ms each. Cells are keyed by instance, as `WORLD_CELLS=grid` opens them; an unmeasured
  cell weighs as a median Open Plot. GC15's crossing between workers means no cell needs its neighbour's worker.
- OF18 (OFFLINE): a world build turns `?chunk=<slug>` into a grid entry and bares the address, which dropped `skipintro`
  too, so the title stayed up over the loaded world. Every Open Plot in the offline proof is entered that way, hence its
  "title-drop" in every mode. The bare address keeps `skipintro`, `mute` and `nolock` now. Local staging-like proof: green.
- SC10 review points: the lead seat's loot goes under its player's own id when they leave (a bounce no longer re-farms a
  bounty; the next lead still starts afresh, J105); an empty lead seat's taming session is released and starts wild again (the
  next lead rode the last one's horse); a retired bonded horse leaves the mounted owner's rows first ("Missing mounted pose
  actor" failed the worker on the next step); an elite's skin orb stays until every player present has taken theirs.
- Tests: `served-lead-taming` (red without the parked release), `served-world-prunes` (lead bounce), `elite-skin-per-player` (two takers, one kill).
