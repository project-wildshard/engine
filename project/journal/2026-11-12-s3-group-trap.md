# 2026-11-12 SENTRY-TRIAGE S3: the engine trap test

- `test/group-guest-trap.test.ts` closes S3's last engine item: a v2 group whose guest traps keeps its prior state and
  reports once. The fixture module (`test/fixtures/group-trap/`) traps by `unreachable()` and by a loop the fuel meter
  stops, the second being how WILDSHARD-GAME-82's herd died. Engine's suite has no AssemblyScript compiler (J42), so
  `build.mjs` bundles sharddev's v2 compiler with sharddev's own esbuild, as boss-tell's fixtures do with v1.
- Surprise: every other GroupStepV2 test is lift-pending (it imports `src/sharddev`), so this is the only group v2 test
  engine runs today against real Wasm.
- Red on mutants: reporting every trap (4 faults, not 1); a host left busy after a trap (the next call refuses).
- Codex review (one `codex exec`): two MUST, both fixed. (1) The traps came before the guest's RNG draw, so RNG
  preservation was vacuous: the module now draws and writes its bank before either trap. (2) The test reimplemented
  the grazer's catch: a third test binds the module to a real herd `GrazerBrain` (Nalati's admitted herd bank and
  signals in `herd-rows.json`, two random streams) and traps on `tick`; herd, body and both RNGs are unchanged, one
  fault. Red when `tick`'s catch rethrows. NIT fixed: `build.mjs` resolves a relative sharddev path.
