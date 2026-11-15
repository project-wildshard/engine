# Failure modes (MMO-FAILURE-MODES, lane opus-fm1)

- FM3: `scripts/failmode-proof.mjs` (+ `failmode-cases.mjs`): the rig behind FM2's chaos proxy, one fresh headless context per
  case, real faults armed from Node, `data-failmode` screens judged, real recovery. `--prepare <work>` makes the owned key and a
  Driftwood build stamped with the proxy's release address. The door lets 10 connects a minute per address, so play cases wait
  out the minute (`--cooldown`) instead of lifting the cap. The proxy now forwards one bounded `?chunk=` (grid pages dial
  `/?chunk=<cell>`; it 404ed them) and counts upgrades. First run: drop passes; release-5xx sits at LOAD with no word.
- FM5: a failed release read with no kept copy no longer hangs the load at LOAD. `release.ts` types each failure
  (`ReleaseReadError.fault`: offline, network, timeout, status + Retry-After, portal, unsigned) and `releaseToDial` takes a
  `wait` port that shows `releaseScreens.ts`'s page and reads again by the stated policy (2/4/8/16 then 30 s; 429 as told or
  20 s; 404 each minute; offline, portal and bad signature wait for the network, the page in view or a tap). Title screen
  stops the load. Staging pages carry the session's staging mark (46); the new-build panel carries `version-skew` (23).
  `release-unsigned` joins ERROR_SCREENS (reported once a page).
- FM6: a failed content read now says what failed on the loading card's line, with the catalogue's id on it
  (`packs-5xx`, `packs-429`, `book-5xx`, `packs-5xx pack-broken`, `storage-full`) and its age; the address moves off the
  line (still in the wait's label for diagnostics). `ContentReadError` keeps the measured status, Retry-After and a broken
  length; a 429 that says when waits that long (cancellable, counted down on the line) before the retry the budget already
  allowed. A spawn download that can't keep bytes (quota) shows Storage is full until it ends. Mode 36's page is left.
