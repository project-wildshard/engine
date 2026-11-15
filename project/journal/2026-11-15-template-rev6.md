# Template rev 6 pinned (buddy-engine, for opus-mossrender3)

- Engine pins `template` revision 6 (`d9d5cb68…`, 16,335,872 bytes,
  sdk 0.3.0, shard-format 0.5.7, engine 0.1.19 preparation), on preview
  and staging. `pins.ts refresh` reads production's live heads, which
  are older (it would have moved template back to rev 3 and another pin
  to rev 1), so the row is pinned by hand from
  `GET /api/catalogue.json?channel=staging`, as revs 4 and 5 were.
- The tarball is on the `pins` release (it was the only pinned tarball
  missing there; rev 5's `47ebcbb5` never was).
- The level moved, so Ring 1's template chain is re-recorded
  (`aa87f47f…`); Darwin and Linux held the same chain for every row, so
  linux-x64 takes it too (CI's compare confirms). The v0.1.1 Template
  save is refused by rev 6, as by rev 5.
- Boot stamps unchanged after a full `pnpm pins`.
