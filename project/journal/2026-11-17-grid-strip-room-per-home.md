# The grid strip room is per home (preview red, buddy-engine)

- Preview deploy has been red since 00:43 UTC (run 43989368168), not
  since da47f285: `Grid strip blocks are 3988526 wire bytes, over the
  3700000`. The last deploy that released (43978811325, f77f45c6) had
  27 homes; later green runs skipped the release.
- No engine commit grew it. Preview bakes staging's grid (SA35): the
  pinned 25 cells plus what staging placed. Serial 19 placed 2 cells,
  serial 20 placed 3 (3,805,429 bytes), and serial 28 placed 5
  (glowfen, mirror-salt, mossgate, thin-ice, mu9-auto), which gives
  3,988,526. Each placed cell adds about 90 KB of road.
- ZE4a sized the 3.7 MB set for the pinned 25 homes. A fixed set goes
  red at every placement, so the room is now `perHome` (148000, the
  old set over 25) times the distinct homes the bake bakes
  (`gridStripSetBudget`). The pinned grid's budget is exactly 3.7 MB
  as before, and a block encoding that grows is still refused.
- Every home reads the whole set (ring, then outer road), so these are
  phone bytes: 4.0 MB at 30 homes, inside the 60 MB first-download
  ceiling (PAGE-SIZE, SHARD-SIZE).
- Local bake: pinned 25 homes 3,504,828 of 3,700,000; staging's grid
  (preview-grid.ts) 30 homes 4,288,779 of 4,440,000. The local total
  is higher than CI's 3,988,526; local pins differ from CI's.
