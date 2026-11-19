# Retire the Template's readers (TEMPLATE-E2E TR-5, opus-templates5)

- 27 tests and proofs that read the Template's gameplay rows (grey blob, Warden, whip, racked sword, lantern, lift, chest,
  hut door, talk tape) now read `test/fixtures/gameplay-slice`: the server slice of the last Template pin (rev 10,
  `cc1fcd31`), 1.3 MB, no art. No other pinned product carries that gameplay until TR-12 moves it onto Mossgate; then
  these tests read Mossgate and the slice goes.
- Tests that only needed a product or a slug boot Brasscap: the saved-door reload (its canyon gate), lone restore, session
  exit, core heap, look-loop, boot route, the exported harness, cook preparation, the online rig's second build, and Ring
  1's pin grid journey (now walks north out of Brasscap's (0, 1) filler cell: the old east route was the Template's).
