# Server cells: memory and ticks per resident cell (opus-cellmem)

- Measurement only, for meta's draft SERVER-CELLS-PLAN (Jake, ~10:20 Cancún: "What's the RAM impact on the server when you
  boot it with 1 cell or 2 or 8 or 16 or 25 cells hot in memory?").
- `scripts/cell-mem/metrics-preload.mjs` is an `--import` preload, so any release bundle can be read with no server change:
  Prometheus text on a loopback `METRICS_PORT` (RSS, CPU, heap and external per thread, event-loop lag per thread, and the
  door's `worker` rows). `scripts/cell-mem-bench.mjs` runs a kept `mmo-bots.mjs replica --keep` bundle once per cell count,
  dormant then with one bot per cell (`cellMemBotsEntry.ts`, deep-linked `/?chunk=<instance>`). On macOS it also reads
  `footprint`, since RSS drops when the kernel compresses a quiet process.
- First numbers (staging build `6d11b137`, 4 workers, a Mac at load ~40): 25 cells resident at boot, about 1 GB; with a bot
  in all 25, the worker holding 22 cells falls to 30 ticks/s.

## SC1: `/metrics` in the server (opus-sc1)

- `src/server/host/dedicated/serverMetrics.ts`: `METRICS_PORT` (unset: off) serves Prometheus text on 127.0.0.1 only, so the
  preload above is retired and `cell-mem-bench.mjs` reads any bundle built from here with no `--import`. The client is
  `@prometheus-io/client` 0.16.1, the Prometheus org's successor to the deprecated `prom-client` (same API, same defaults).
- Worker rows gain their own lag, external and array-buffer bytes, when the door asks for metrics; the door times crossings
  (`wildshard_crossing_seconds`) and counts `cell.booted` (`wildshard_cell_boot_seconds`). Seats on a worker's road now
  count as players in its reading.
- Proof: `test/dedicated-metrics.test.ts` (a two-cell world, a crossing, every family); a bench run on staging's build
  `c5359cb4`, counts 1 and 2, read straight off the bundled server's `/metrics`.

## SC4, SC5 (opus-cells, ~22:15 Cancún)

- SC4: a cell runs 60 ticks with nobody in it as it opens (`cellHost.ts WARM_TICKS`), so the lazy first-tick work (animation
  channel programs, Rapier's first step, the JIT) is paid at boot, not on the first arrival. Driftwood's first-arrival tick max on an
  idle Mac went from 29-30 ms to 6 ms.
- SC5 (J328, grill Q3): J107's start-over is retired for grid cells (`gridCell`); only a cell the grid does not place still
  starts over. A grid world is never rebuilt, so its respawns carry what the start-over used to reset.
- SC5 gaps (audit of what the start-over used to reset): a served world now refills with one player in it (`CreatureRefill`
  `served`, the roster, native returns, wild stallions), a player who leaves takes their bonded horses with them (no pile-up past
  the taming roster's 64), and a beaten boss (boss rows, phase encounters) stands again once its arena has stood empty 5 min,
  its reward too. Wake fights, open arenas, once-elites, elite skins and some per-player maps are left as a follow-up row.
- SC7: `cell-mem-bench.mjs --remote wildshard-agent` runs the matrix on the box (replica on staging's cores 9-13, bots on 14-15,
  scrapes over ssh); each count reports `arrivalTickMax` for SC4.
- SC10 item 1 (opus-cells2): Driftwood's wake fight comes back in a served world: after the pool stands empty 5 min the world's
  `dead:captain` clears and the captain's body retires, so the next wake cue spawns him afresh. Found on the way: since SC5 a served
  world owed the dead captain as a roster body, which has no scale row and threw in the tick 5 min later (failing the worker); the
  captain is now reserved from native returns.
- SC10 item 3: a served world's returned boss is a fresh world's record: `BossBrain.returnBeaten` sets `defeated` false too, and the
  arena room's `boss.<id>.defeated/paid` (and any boss row's flag record) clear with it, the room's unclaimed orb too. The flags still
  only ever set otherwise, so a page's or tape's record is unchanged.
- SC10 item 4 (skins): in a served world an elite's skin is each player's own: a kill lays the orb out while a present player lacks
  it, a press takes it for the presser (`elite.<id>.skin` in their own book, claimed, so it rides their save), an owner's press takes
  nothing. Not done: the once-elite (Nalati's Argymaq) still retires its lair for the world when tamed; per-player taming needs the
  world-single bond, the companion and the projected lair's respawn reworked ("respawn is not hosted"), and the shard author's word
  that Argymaq is not meant to be unique.
