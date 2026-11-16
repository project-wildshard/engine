# The cook's 6x6 workers load from an installed engine (row 41, buddy-engine)

- Mini QA 2026-11-16 row 41 (NB18): every shard repo cooking with the
  npm engine died in `wasmAstc6().flush()`. That path is reached from
  `cookShard` through `defaultCookTiers()`, and it failed with
  `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` (Nine ring-2-cook, ci
  run 43902269884).
- Cause: `flush` starts `eval` worker threads that `import()`
  `astc6Wasm.ts` itself. An installed engine ships raw `.ts`, and Node
  strips types under `node_modules` only through
  `scripts/format-hook.mjs`, which uses `registerHooks`. Module hooks
  are per thread, so a worker never has the hook. `--import` and
  `NODE_OPTIONS` on the parent don't reach an eval worker either, which
  the mini had already tried.
- Fix: the worker imports the format hook first, given its URL beside
  the module's. In a source checkout the hook matches nothing, so local
  cooks don't change.
- Test `test/cook-astc6-installed.test.ts`: it lays out
  `node_modules/@wildshard/engine` with the encoder, the hook and the
  vendored basisu, then runs a fresh Node that does what a shard repo's
  cook does: the hook, then `wasmAstc6({lanes: 1})`, one input and
  `flush()`. It failed first with the exact error and passes with the
  fix.
- Nine's workaround (`tiers: {}` in `test/ci/cook-play.test.mjs` on
  `plan/nb18-sdk03`) can go once Nine pins an engine with this.
