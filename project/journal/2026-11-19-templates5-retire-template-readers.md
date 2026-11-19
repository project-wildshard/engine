# Retire the Template's readers (TEMPLATE-E2E TR-5, opus-templates5)

- 27 tests and proofs that read the Template's gameplay rows (grey blob, Warden, whip, racked sword, lantern, lift, chest,
  hut door, talk tape) now read `test/fixtures/gameplay-slice`: the server slice of the last Template pin (rev 10,
  `cc1fcd31`), 1.3 MB, no art. No other pinned product carries that gameplay until TR-12 moves it onto Mossgate; then
  these tests read Mossgate and the slice goes.
