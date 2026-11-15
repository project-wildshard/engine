# Failure modes (MMO-FAILURE-MODES, lane opus-fm1)

- FM3: `scripts/failmode-proof.mjs` (+ `failmode-cases.mjs`): the rig behind FM2's chaos proxy, one fresh headless context per
  case, real faults armed from Node, `data-failmode` screens judged, real recovery. `--prepare <work>` makes the owned key and a
  Driftwood build stamped with the proxy's release address. The door lets 10 connects a minute per address, so play cases wait
  out the minute (`--cooldown`) instead of lifting the cap. The proxy now forwards one bounded `?chunk=` (grid pages dial
  `/?chunk=<cell>`; it 404ed them) and counts upgrades. First run: drop passes; release-5xx sits at LOAD with no word.
