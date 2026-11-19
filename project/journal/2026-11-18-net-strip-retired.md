# 2026-11-18: net-strip-browser.test.ts retired (T1E-8, J434)

Meta TEMPLATE-E2E T1E-8. Jake signed it off with J434 ("Delete the old
legacy template & template-blender stuff"). The file was E7.1b's proof that
a real browser sees the reconnect strip appear and clear. It ran only by
name (`WS_STRIP_PROOF=<folder>`), so no push or CI ran it; the T1 suite's
shard D `drop` case (T1E-7) is the proof that replaced it.

- Deleted the test; dropped it from `push-local-split.mjs`'s browser list and
  `test/shared-worker-tests.json`.
- `vitest-cpu.ts` held a machine browser slot for this one file; with it gone
  every file takes the CPU lease, so the reservation import goes too.
- T1E-8's other half, Ring 1's boot-smoke without `_template`, is TR-3: Ring 1
  moves to Brasscap with its digests and the Template road crossing.
