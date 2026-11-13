# The audio download proof, in WebKit (AUDIO AU14)

> Written by: Claude (opus-au14), 2026-11-13

AU14 is the real-path check under J299: on staging, audio comes down with DOWNLOAD and LOAD never asks the network for
it. `scripts/audio-download-proof.mjs` runs it in headless WebKit at 402×874, a fresh profile per shard and route, a warm
visit and then a 0.7 Mbit/s, 300 ms visit.

**What was new to work out.**

- WebKit has no CDP, so the offline audits' `Network.emulateNetworkConditions` can't shape its link. A Playwright route
  can't either: it makes the service worker skip its cache (AU2's finding). So the proof runs its own forward proxy and
  points WebKit at it with `bypass: '<-loopback>'`, which in WebKit does send loopback through the proxy (the local
  build's http reads show up in its log). The slow link is one FIFO per direction, drained by one timer; the first cut
  used a `setTimeout` per piece, and Node's cached loop clock let a later piece fire first, which broke TLS in a tunnel
  (the `claude -p` review caught it).
- The card's phase is stamped by the page itself (a MutationObserver sending each change through a binding), because a
  200 ms `page.evaluate` poll lags by seconds while LOAD keeps the main thread busy.
- "Audible" is an AnalyserNode beside each mixer bus. The init script watches `AudioNode.connect` and finds the buses by
  shape: the master is the gain feeding a low-pass feeding the compressor (`Audio.ts` `graph()`); its first input is
  `world`, whose first input is `sfx`; any later master input is Music's duck gain. (A count of long buffer sources was
  tried as a second check and dropped: music plays in short windows, so it read 0 on working music too.)
- Staging-like local builds can't seat (rooms-staging refuses a loopback origin's socket), so they are judged at the seat
  wait, as offline-proof.mjs does; audibility is judged on staging and on the solo preview shape of the same build.
- On a world build a `?chunk=` deep link takes the grid manifest too (OFFLINE OF2), so Driftwood's one-shard `client`
  manifest only runs on the preview shape (`--target=preview`).

- A deep link with `&skipintro` (the offline audits' Open Plot entry) is the bench path: play.ts `markEntered` never runs
  ENTER WORLD, so `music.play` never runs on a one-shard page and `audio.worldMuted` stays true on a grid page. The first
  runs read that as "Thin Ice has no music" and "Driftwood's deep link is silent". Without the flag, a world build's
  deep link stops at the title and a solo page loads the shard and then lands on the title. So the proof judges sound
  on the deck entries and on preview's Driftwood deep link (continued by Shard select), and only reports it on the
  bench entries.

**What it found.** LOAD made no audio request on any shard, route or link (staging, the local staging-like build and
preview), and every route's manifest carries the shard's AU6 audio. Music and sound effects are heard within 0.7 s of
play on every player entry. An Open Plot's music is not measured: its only drivable entry is the bench path.
