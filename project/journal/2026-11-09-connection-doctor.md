# The Connection doctor

Jake (2026-11-09): "For this preview thing that depends on connecting
over tailscale to the backend, can we add some new UI features to just
like 'check' or 'Doctor' that everything is good."

- The doctor is its own page, `doctor/index.html`, built in its own
  module graph (`scripts/app-build/doctorOutput.mjs`): 49 KB, 17 KB
  gzip, no worker, packs, renderer or game stylesheet. As a second
  input of the client's Vite build it shared chunks with the game, the
  page preloaded the game's code and CSS, and the title chunk went over
  its budget. The stamp step stamps it like index.html, so it reads
  `__WS_BUILD_ID__` and `__WS_WORLD__`.
- Seven checks in order, each with its own limit: page and build,
  signed release (Ed25519 against the pinned key), packs origin (server
  book and one part), server `/health`, socket and join, latency and
  clock, this browser. The join says the game's own `hello` (J197) as
  a fresh `doctor:` device and never sends `ready`, so the door answers
  `resume`, `full` or `reload` and no body is seated or saved.
- `/health` now sends `access-control-allow-origin: *` and `now`, so
  the page can read the server build and the phone's clock offset.
  Older servers still pass as "reachable" through a no-cors fetch.
- Ways in: `/?doctor` and `/doctor/` (index.html's first script sends
  either past the service worker with `sw=0`), the title's Check
  connection on world builds, Settings ▸ Connection and the pause
  menu's saves panel for everyone, the Name box, the Connection lost or
  World is full strip, the failed-join modal and the LS4 failure
  screen. The game page hands its LS4 report and the way back over in
  sessionStorage, so Copy report carries both.
- The online module is its own bundle, so it asks the page by a
  `ws:doctor` event rather than importing the page's save hold.
- Avoided package.json exports on purpose: package.json is in the
  validation revision, and one new export makes every product's receipt
  stale. The BitWriter import has a reasoned public-index exception.
- Proof: `test/connection-doctor.test.ts` on a real door and socket;
  `scripts/doctor-proof.mjs` in Chromium and WebKit, healthy, server
  stopped, release signed by another key, and a proxy that refuses the
  WebSocket upgrade, 22 to 24 checks each, all green.
- Published from a clean clone of origin/main (the shared tree's old
  stamps blocked the queue's rebase); the proof script now passes the
  typed lint the full gate runs.
