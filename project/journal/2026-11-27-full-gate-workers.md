# 2026-11-27: the full push gate fits its cap again

- Meta QA 11-26 row 70. `release/v0.1.101` repair `56c424129d` hit STUCK in `vitest (full)` at 900 s twice. 33c59458d
  (11-26) capped every gate's Vitest at a quarter of the cores, 4 here. The hosted timings table sums to 6,686 s over
  2,455 files: about 1,670 s on 4 workers, over the cap before any load. 900 s was ~3x a related run, not the full one.
- The full selection now runs on half the cores (`fullSuiteWorkers`, 9 here; `WS_GATE_FULL_WORKERS` overrides). Every
  file still holds its own machine CPU grant, so other lanes keep their share. Related and split gates keep the quarter.
- A full Vitest step's stuck limit is 2x the table's expected wall on its workers, never under 900 s (1,486 s today).
- `src/scripts/vitest-progress.mjs` is a Vitest reporter the gate adds to every Vitest step. Its end line names the
  slowest files and any over 120 s; a STUCK line and receipt name the files still running.
- Proof: one full run (WS_FULL_SUITE=1, approved by the coordinator) at 9 workers through the CPU grants, beside
  opus-batch's gate at load 6-14: 2,545 files in 449 s. Slowest: vps-harden 67 s, land-cleanup 41 s, land-guards 35 s.
  The one red, rig-ports, was the clone's deep path: its Unix socket path passed macOS's 104-byte limit.
