# Phone frames enter alone (opus-phone99, meta QA 11-25 row 99, J522 (4))

- Budgets run 45755470720 timed out every zone's phone Low and High capture at 235 s, so the ledger step never ran and
  no budget was checked on main. CP17 had moved `phone-frames.mjs` to the title's tap: `enterZone` with no `alone`.
- Why it never settled: a tap enters the zone's grid cell with its neighbours, and a grid page runs the grid's level,
  `platform.grid`. The wait asked for `level.id === <zone>`, which never holds there. Locally (headless, muted,
  swiftshader) brasscap-mesa sat entered, playing and unpaused at frame 2,213 on `platform.grid` when it gave up.
- J522 (4) says measuring tools load a zone alone, so the tool now enters a one-cell world (`alone: true`). That world
  runs `platform.grid` too, so both waits read the zone from the grid's own cell (`shard.grid.state().inside`, as
  seat-hold-proof reads it), and a one-shard page's level id still counts.
- Glowfen, Mossgate and Mirror Salt have no grid cell in the build (MZ26), so `oneCellCatalogue` gained `unplaced: true`:
  it seats a built zone the grid doesn't place at the origin. That replaces phone-frames' own `measuringCatalogue`.
- The guard: `chunk-param-guard.mjs` now also fails a Playwright measuring tool (budgets, memory, goldens, gpu-gate,
  frame-floor, bench-load and the rest) whose `enterZone` has no `alone:` or which writes a tap by hand. frame-floor's
  public-grid arm measures the grid on purpose and carries the `chunk-param-guard: grid arm` mark.
- The one-cell world counts more programs than the deleted one-shard page did (brasscap Low 49 against 34, Glowfen 82
  against 51); the keys over their line are declared with this row, for the next pin lane to record (row 68 (t)).
- Declared (85 keys, budgets/baselines.json): every phone programs key and phone-Low draws key. A local sweep of 20 of
  27 zones, none timing out, read about +18 programs and +7 draws in every zone, the open plots most clearly (41 to 44
  programs against 22 to 25), with triangles moving only with content: the grid shell, not new weight.
