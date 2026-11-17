# CI's test lists drop the removed ci21 originals (main red, buddy-engine)

- Main on d3cead51: tests (3) and (6) hit ENOENT. CI21-PORT's
  `746b4fc7` removed 69 verified originals, but
  `test/local-gate-scenarios.test.ts` still read
  `test/scripts/ground-encounters.test.ts`.
- One pass over all 69 removed paths: `scripts/vitest-ci-files.ts`, the
  file list CI runs native groups from, still named 9 of them. It also
  named `sky-progression-verbs`, from the earlier Sky pairing
  (`a05466fc`). Removing them emptied the `chapter-one` group, so that
  group goes too; nothing else names it.
- Left alone on purpose: `scripts/test-products.json` keeps its keys
  for removed files. `local-gate-scenarios` uses those scenario keys as
  the selector's data (`test/scripts/` is gone entirely), so pruning
  them is the ci21 lane's call. The lift ledgers
  (`engine-lift-disposition.json`, `lift-pending-policy.json`) and the
  old CI yml fixtures are history.
- New `test/test-lists-name-files.test.ts`: every file CI runs by name
  exists, and no group is empty. It was red on main's list and is green
  now; `local-gate-scenarios` drops only the read of the deleted file.
