# The lean move's red: paths it left behind (opus-lean91, meta QA 11-25 row 91)

- f928fdae2 moved `scripts/` to `src/scripts/` and rewrote `'scripts/x'` strings, but not a path built from parts:
  `$REPO/scripts/x` in serve-build.sh (every preview start died), `/ 'scripts' / name` and `(root / 'scripts').mkdir()`
  in the Python tests' temp checkouts, `./scripts/...` inside a `node -e` source, `ROOT / "scripts"` as a tool root.
- Two tests changed meaning, not paths: save-epoch-cut walked `scripts/` (now inside `src/`), and the stream-reader
  scan of `src` now reached the tools; it keeps its old scope (`:!src/scripts`, `:!src/test`).
- The push-input fixture's `src` inventory now holds its own `src/scripts/push-inputs.mjs`, and the commit-message
  fixture's human commit names SKIP_ATTRIB (row 51's hatch rule, which arrived with the move).
- The guard that stops the next one is row 91's second half (repo-kit script-paths).

- The static lane stayed red after e60a4cf97: ci-static.sh's `proof` imported `./scripts/$loader`, and it ran
  `pnpm test:hooks` and `pnpm test:agent-hooks`, two scripts the lean package.json dropped. It now runs the loader
  from src/scripts and the two node --test globs itself.
