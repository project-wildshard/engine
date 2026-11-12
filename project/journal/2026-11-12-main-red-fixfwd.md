# Main red after b18b0b25, fixed forward (opus-fixfwd2)

- Run 43306998669 (128511a2..b18b0b25) was red in three jobs.
- `test/wire-lockfile.test.ts`: 1e99d663's install added `gitHosted: true`
  to both wire entries in `pnpm-lock.yaml`. That is the WR2 trap, not
  churn: a frozen install from an empty store then installs the repo root
  under the wire's name. The flag is dropped again.
- `test/room-frame-bytes.test.ts`, armed Nalati room: 75a5d6ae (SS4) gives
  every room seat a stealth seat whose state the digest hashes, and a
  Hidden arrow hits for x2. With the seat's install skipped the old digest
  matches, so the digest is re-taken.
- `products` (Ring 1 cook) has been red since a5d17381 (TE-PIN1, Brasscap
  rev 2): "Blocked edge entry north lane 0 at 33.23m". The pin files go
  back to rev 1 (`test/pins/*`, `scripts/physics-route.json`,
  `test/released-save-play.test.ts`); the format bump stays. Re-pin rev 2
  once the canyon's north edge entry walks.
- Ring 1's step then went red on two chains: f62f6cf7 (HS2) drives
  moored movers on the server, so driftwood-isle and sunscar-dunes step
  new bodies. With HS2's two files reverted the old chains match; the
  new chains are recorded for darwin and linux (CI's prefixes match).
- Run 43311635198 (aabe750f) then failed all six shares in the planner:
  it read run 43309009626's table, measured on a slow runner (3,043
  file-seconds against 2,931 on the green f1bb557f run), so 15 shards
  floored at 256 s, over the 240 s bar, and `engine-ci-plan.ts` threw.
  No file grew past its budget: the bar is just tight. A floor over the
  bar is now AMBER (J295): the planner takes its fastest shard count and
  warns, naming the five heaviest files. The next table (43310707036)
  plans 13 shards at 229 s.
