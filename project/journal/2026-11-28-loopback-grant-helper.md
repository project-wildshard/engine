# 2026-11-28: one loopback grant, where the routed page is made

- Meta QA 11-26 row 80 said eleven rig harnesses open Chromium with no `local-network-access` grant and would stall the
  way Nine's walk did (row 75). I ran two on Chromium 158 headless with no grant: seat-hold-proof played Driftwood and
  Dunes online, and online-ride-proof seated both pages on Nalati. Neither stalled. The premise was wrong.
- The cause is narrower. Chromium's Local Network Access check sorts a page by the address its document came from. A page
  the rig serves itself is loopback, so reading the rig's release file on another loopback port needs no grant. A page
  document that a Playwright route serves (`route.fulfill`) has no address, so Chromium counts it public and denies the
  read. enterZone's `alone` one-cell page is served that way, and that is how bootZone opens Nine's walk. A two-port toy
  showed it: a direct page read the other port, a routed page got "Failed to fetch", and a routed page with the grant
  read it.
- Fix: `src/scripts/loopback-grant.mjs` `grantLoopback` is the one place that grants it. It grants Chromium and
  persistent contexts and skips WebKit and Firefox. enterZone calls it before routing an `alone` page. The five sites
  that granted by hand now call it: the walk, boot-smoke, zone-cook-entry and the two cooked-zone proofs. So does
  phone-memory-card-proof, which also routes a one-cell page.
- Guard: test/loopback-grant.test.mjs checks which browsers get the grant and that enterZone grants before it routes. It
  also refuses `local-network-access` named anywhere but the helper, and a routed one-cell page with no grant.
- Found on the way, not fixed here: online-ride-proof's two pages are seated on Nalati but never reach the camp horses
  (223 m left of the walk). That looks like the same page-cell against server-cell kind as row 79.
