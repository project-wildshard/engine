# Engine reads Brasscap from shard-format's pinned export (buddy-engine, SHARD-SOURCE SS4)

- SS4's engine half. shard-format 0.5.7 (0.5.6 was tagged but never
  published; 0.5.7 folds it in) ships `corpus/exports/brasscap-mesa/`,
  a `wildshard build` of a pinned shard-brasscap commit, in place of the
  hand-written `corpus/brasscap-mesa/`.
- `@wildshard/format` goes `^0.5.3` -> `^0.5.7` (the lock was still on
  0.5.3, so this also brings 0.5.4's PBR keys, 0.5.5's painted sky and
  0.5.7's view draw budget into engine's install).
- `scripts/pin-format.ts` `FORMAT_PRODUCTS['brasscap-mesa']` reads
  `corpus/exports/brasscap-mesa`. `test/pin-format.test.ts` reads the
  folder from that table and passes, 4 of 4. Lint and the full layered
  typecheck (`tsc -b --force`) are green.
- Gotcha: an incremental `pnpm typecheck` here reported missing exports
  in `workerTable`, `pageEntry` and `productInputs` that the source has:
  stale layer build info. `--force` cleared it.
