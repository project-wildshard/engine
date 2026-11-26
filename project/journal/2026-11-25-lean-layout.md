# Engine moves to the lean layout (repo-kit A3, shard-lean-layout R1)

- The kit's scripts are src/scripts/.kit/, its tests src/test/.kit/;
  engine's own scripts are src/scripts/, its own tooling tests
  src/test/ (with parity/ and soak/). kit/ is gone: its lint config is
  .oxlintrc.kit.json at the root, its TypeScript options sit in
  src/tsconfig.json. The verbs are the D33 set (prepare, fix, test
  runs the kit and hook suites too). Land, main-push and the plan
  worktrees stay (J240).
- Published subpaths keep their names (@wildshard/engine/scripts/x),
  so shards and sharddev import as before; their targets are
  src/scripts/x.
- The mover missed root lookups that are not imports: here('../src'),
  a bare '..', split '..' arguments, rootDir, tsconfig references,
  escaped paths in regex literals (push-path-edges, precommit-jobs'
  neighbours, a dozen tests), the pre-push gates (format-api-gate
  behind an [ -f ] that went false), check-page-events' script rule
  and the saves lock's walk of src/. Each is re-pointed.
- Python and shell tools climbed one folder short (Path(__file__)
  parents, $(dirname "$0")/..; ci-static.sh would have run in src/).
  The mover also re-counted '..' that were no climb from the file
  (git ranges, part === '..' guards, resolve(x, '..'), the format
  package root, the sibling repo-kit path); those are back as they
  were. Fixtures that build a temp checkout make src/scripts/, and the
  path rules (push-selection's harness, gate-related-tests,
  strip-only's entries, chunk-param-guard's keys, pre-push's guards)
  name src/scripts/ and src/test/. Every test file the move touched
  (547) now fails only where it failed before the move.
- Vitest collects the own tooling tests from src/test/ (they were
  test/**/*.test.* before); the layer rule treats src/scripts/ as
  outside the layers, as scripts/ was.
- Hooks move to hc with the kit: lib.mjs keeps its reviewed secret
  false positives, the brief keeps K13a's last 10 decisions, herdr's
  hooks and helpers go. The commit refusal names pnpm fix.
- After this lands: the phone runner and the nightly fps launchd jobs
  are reinstalled from src/scripts/ (their plists named scripts/).
