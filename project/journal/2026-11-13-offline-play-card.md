# The offline-play card (buddy-engine)

- MMO-FAILURE-MODES FM4b, mode 2, the card Jake asked for in the offline
  plan (J298: a world build that lost its network shows mode 2's
  `offline-play` card in the world). OF18's staging check expects it.
- Before: a phone that lost its network looked like any dropped link.
  Redial dialled every 4 s into nothing and gave up at 2 minutes with
  `lost` ("Couldn't reconnect"), so a train tunnel ended the session.
- Redial now asks `online()` (default `navigator.onLine`, a browser with
  no answer counts as online). Offline, it dials nothing and its give-up
  clock stands still; the cause is the new `offline`. The network back,
  the clock goes on from where it stopped and the dial goes out at once.
  The server's own seat hold (J114) is the server's and goes on: the
  card claims no hold or save time (J229).
- linkScreens shows `offline-play` for that cause instead of the banner.
  A tap the world must hear is refused under it (no hold card on top), a
  chat line is still held for the link, and the card closes by itself:
  to the Reconnecting banner when the network is back, to the
  Reconnected notice when the link is.
- Proof: `test/net-redial.test.ts` (ten minutes offline is neither
  Resuming nor lost, one dial on return, the clock resumes),
  `test/online-link-screens.test.ts`, and the real-browser
  `test/net-strip-browser.test.ts` now goes offline with Playwright's
  `setOffline`: the card shows, no rejoin while offline, back in one
  dial.
- Known edge: `navigator.onLine` is false on a machine with only
  loopback, so a local playtest with the Wi-Fi off won't redial after a
  drop. The first dial still goes out.
- Left of FM4b: mode 5 `unreachable` (needs a measured `/health` read)
  and 4, 6-8, 21, 22, 42, 45; FM3's `fm_proof` is still the row's
  done-when.
