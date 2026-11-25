# SKIP_CHECK never carries another lane's commit past the gate (meta QA 11-25 row 53)

- opus-fp54c: engine 5068a7365 (scripts/trailer/capture.mjs, TS7006) was refused by its own main-push gate at
  12:11 Cancún and stayed on engine-quickfix's local main. At 12:12 opus-fr13's main-push, run with SKIP_CHECK=1 for
  its commit lane, carried it along (M1): SKIP_CHECK reached the pre-gate and the push lane, so nothing typechecked
  it, and the pre-gate marked both commits gated. main went red on typecheck (run 45662209325). The gate already
  runs main CI's typecheck (kit + layers); the hole was the skip. Now a carried commit drops SKIP_CHECK and its gate
  runs, and a skipped gate marks nothing. Test: a push adding an untyped .mjs is refused, own or carried.
