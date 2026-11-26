# The nightly's cold heads boot on the grid path (opus-floor143, meta QA 11-25 row 144)

- Fresh release proof 45818175476 (133519b49) failed every Chromium head's boot with a 404 for
  `/assets/spawn/<slug>-grid-phone-<hash>.json` on the cold cook's origin, and every Explorer with a 404 for its art.
  Reproduced locally on one head, on Chromium and WebKit (same harness).
- Boot: since CP22 a head's page boots its one cell on the grid path, which reads the packs book's grid rows. The nightly
  detached the head's client rows and attached its cold cook's, but left its grid rows naming the build's own grid
  manifests, now asked of the cold origin. coldGridRows points the head's grid rows, every variant, at its cold whole
  rows, as production plays a stored cook's grid entry from its whole rows (placedSpawn).
- Explorer: two reads lost a stored cook's art, which lives in its upload's `loose/<hash>/` folder on the cook's origin.
  readDiscovery took the discovery URL's origin alone as the art's home (discoveryHome now keeps everything before
  `/shardfiles/`), and the boot's art preload (extras.ts pathOf) kept only the path, so it asked the page for it. pathOf
  now keeps a URL on another origin whole. Production's placed slugs read their card art through the same two functions.
- Explorer, then: with the art served, the page still sat on the Explorer's hub for 180 s. Since the hosted drivers tap in
  (99a58a5b5), the smoke's page carries both a tap's Explore arrival and its own `?explore=model` route, and finish.ts
  started the viewer for each: the first opened the model view and re-pointed hud.onExplore at the hub, the second opened
  the hub over it. exploreStarts starts it once: the arrival when there is one, else the route.
- WebKit's runners: this run's four WebKit jobs all got a macOS runner (12:43 to 13:00 UTC starts); the old run's
  "not acquired" was GitHub's macOS capacity that night, not our labels or concurrency.
