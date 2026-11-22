# The game's document says COOP, so a warm boot gets a clean WebContent

Meta IPHONE13-DRIFTWOOD DW12 (mini-dw12e). The iPhone 13 holds a cold
Driftwood boot, but the warm return (same tab: robots.txt, then
`/slug/driftwood-isle` again) is jetsammed 7 to 15 s after control at
1.57 to 2.06 GB: the second boot runs in the WebContent that held the
first. Freeing things on teardown (Rapier from bytes) did not help.

- WebKit gives a navigation a new WebContent when the opener policy
  changes between documents. Desktop WebKit, one tab: COOP page ->
  COOP-less page -> COOP page is three pids; all COOP-less or all COOP
  is one pid; a reload or `location.replace` of the same COOP page
  keeps its pid. `same-origin-allow-popups` swaps the same way.
- So `/`, `/index.html` and `/slug/<slug>` say `same-origin` on every
  channel (pages/worker.ts, preview-server.mjs, the service worker's
  baked document) and nothing else does. COEP stays preview-only, so
  the page is not cross-origin isolated and its loads do not change.
  The only popup (`titleDeck` drafts) is `noopener` already.
- Preview's isolation rule puts COOP on `/*`, robots.txt included, so
  the robots.txt hop does not swap there.
