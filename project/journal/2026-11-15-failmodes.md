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
- FM8 (doctor half, mode 14): `openDoctorPage` HEADs the doctor's own page first (8 s); one that doesn't answer leaves
  the player's page as it was, with the `doctor-http` card (Try again, Back to the game; the measured status in Details,
  and no claim that a passing HEAD proves the later reads). The callers re-enable their buttons when the page stays.

## FM8 mode 32: voice that can't reach a peer says so

A peer on voice still unlinked after every offer retry (four offers, 15 s each, plus 10 s: `VOICE_GIVE_UP_MS`) is marked
`unreachable`; the voice tip says "Voice couldn't connect to <name> on this network. Text chat still works." with
`data-failmode="voice-failed"` and a Try again that asks for the TURN list afresh and offers again. Voice stays on for
everyone else. Proved in `chat-corner.test.ts` over a stub peer connection whose offers always fail; the rig has no
two-peer voice harness, so the manifest case stays blocked, and 32b (talking while it shows) is left.

## FM8 32b: holding talk when voice reaches no one

In hold mode, holding talk while every peer on voice is unreachable shows `voice-failed-blocked` ("Voice can't connect here,
so no one hears you") for 6 s with Try again. The mic still opens, so a link that comes up mid-hold carries the voice.
Toggle mode's press is voice off, mode 32's own recovery, so it is not held.

## Review fixes (one claude -p pass, NO-GO on one MUST)

- MUST: a 429 with `Retry-After: 0` read the release file again at once, forever. A 429 now waits at least the ladder's
  first step, and without a header never less than the first refusal's 20 s.
- Voice Try again stops if voice went off or reseated while the TURN list loaded, skips peers that left, and two offers
  that cross keep the lower id's (the other side answers it), so two players pressing Try again together still link.
- The loading footer's fault comes from the card's own waits; a page-wide note (owner none) shows only when nothing of
  the card's is stalled.
- The doctor-http card: one at a time (the old one's scope goes too), Try again stays on the card while it checks, focus
  on it. The release page stops its countdown once it reads ("Trying…"). Voice tip buttons listen in a per-tip scope.
- Left for a row: `Retry-After` is not CORS-safelisted, so a cross-origin content or release server must expose it.

## FM3 proof reds fixed: Reload stuck at RELOADING, START's foot showing an address

- version-skew: the panel showed, but Reload sat at RELOADING under "Something broke: Frame scheduling is unavailable in
  this host". `leaveAfterPaint` asked the page scope for a frame before setting its fallback timer, and the online shell's
  graph has no browser frame environment, so it threw and never navigated. It now asks for a frame only when frames exist
  (`test/leave-after-paint.test.ts`, red first).
- packs-5xx, packs-429, book-5xx: at START, before Loading owns the card, the shell's foot showed
  "Read failed: /assets/boot-tables-….json · HTTP 503". It now shows the FM6 line with its `data-failmode`.
- The proof opens the play address for its warm and offline visits: the page drops its query once it starts, so a reload
  landed on the title (offline-launch now passes).
