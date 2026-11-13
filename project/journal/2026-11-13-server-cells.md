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
