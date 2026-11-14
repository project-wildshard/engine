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
