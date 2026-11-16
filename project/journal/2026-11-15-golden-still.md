# Golden cameras hold the creatures (mini-goldens2, meta SH-ALL-11)

- Pine camera 11 (bear den) shot its ground cover round spawn, 250 m away, on every run. A trace showed why: the
  den's bears woke within a second of the pose, charged, bit the player (health 45, knocked down the slope) and
  killed it; the respawn put the streaming anchor at spawn. The capture's damage cap is the page's, and on a worker
  page only the server lands a blow. `?bossGod` only refuses boss, elite and add blows, and these bears are plain
  creatures.
- New harness message `HarnessStill` (`window.__workerClientStill`): the standalone server holds every creature in
  the player's world (`harnessHold`, re-applied each tick for creatures that stream in later). Online shells ignore it.
  `scripts/goldens/capture.mjs` sends it after entry and records `still` in the receipt.
- The capture also errors when the player stands over 20 m from its pose at the shot, so this miss can't pass silently.
