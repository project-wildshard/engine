# Retire the Template's readers (TEMPLATE-E2E TR-5, opus-templates5)

- 27 tests and proofs that read the Template's gameplay rows (grey blob, Warden, whip, racked sword, lantern, lift, chest,
  hut door, talk tape) now read `test/fixtures/gameplay-slice`: the server slice of the last Template pin (rev 10,
  `cc1fcd31`), 1.3 MB, no art. No other pinned product carries that gameplay until TR-12 moves it onto Mossgate; then
  these tests read Mossgate and the slice goes.
- Tests that only needed a product or a slug boot Brasscap: the saved-door reload (its canyon gate), lone restore, session
  exit, core heap, look-loop, boot route, the exported harness, cook preparation, the online rig's second build, and Ring
  1's pin grid journey (now walks north out of Brasscap's (0, 1) filler cell: the old east route was the Template's).
- Scripts: the Template-only browser proofs go (quest-complete, split-repair data-shard, sky-trails' blob particles);
  dev, dev-world, loading-card, reload-title and the crossroads probes default to Brasscap; side parity and the offline
  deck drop the Template (Brasscap's side-parity page half still needs a `--record`).
- TR-4b, suite C: its two phone specs each called `test.use`, so C booted the phone world twice (about 53 s each hosted);
  both now import one `phoneTest`. The phone bar spec allows SwiftShader's whole-stage GPU blocks up to 5 s
  (`SOFTWARE_GL_STALL_MS`, a test timeout; Metal keeps J188's 2 s); the planted stall fault is now 6 s. The suites'
  229 MB product download gets 2 min and one retry (run 44497363007's C hung in it for 9 min). Local SwiftShader C: 8 of 8
  in 51.9 s.
