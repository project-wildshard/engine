# shard-pin re-cuts Ring 1 slices, 2026-11-19

- opus-netlag13: Nalati rev 4's pin (5b3605526) kept rev 3's Ring 1 slice
  row and main went red at dfb768cd0 (boundaries, tests 8 and 9);
  opus-tr4b4 re-cut it in 9a7d7df91. shard-pin.yml now runs ring-setup and
  `pins.ts slice` when the slug cuts a Ring 1 slice and commits
  `test/pins/slices.json` with the pin. Test in test/pin-shard.test.ts.
