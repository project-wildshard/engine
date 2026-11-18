# The boot ledger is lent by the renderer (main red, buddy-engine)

- Main went red on run 44220253995 (8128f4f6..69200d3e). EM9
  (69200d3e, mini-em1b) made `bootTrace.ts` import glCounters for each
  checkpoint's ledger totals. bootTrace is on the cold title's graph,
  so `title-shell-graph` found `glCounters`, `allocationJournal` and
  `allocationBytes` there.
- Now bootTrace holds a ledger slot (`provideBootLedger`) that the
  renderer fills right after it installs its counters. Before a
  renderer there is nothing held, so a checkpoint then carries an empty
  ledger. The ledger tests and the title graph both pass.
- Main's typecheck also broke at 30640162 (phone decode workers):
  `TileDecoder`'s `size` parameter property had no type under
  isolatedDeclarations (TS9011). It is `size: number` now.
- Still open: `boundaries`. The session closure is 1,360,404 gzip bytes
  against a 1,360,000 ceiling. Several lanes' commits since 8128f4f6
  each added a little, and the ceiling has not moved since the lift.
  That one is a budget call, not this commit's.
