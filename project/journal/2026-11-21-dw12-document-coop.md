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
- 11-22: a held service worker answers every navigation with its baked
  page, so on staging `/robots.txt` came back as the game with COOP and
  the hop no longer swapped. Off the game's routes the baked page now
  drops COOP (not on an isolated channel). Phone, 11-21 (serve-local,
  no worker): the warm game reuses the cold game's pid after a swap out
  to robots.txt (the visible pid goes cold -> robots -> cold), and 3 of
  3 warm returns held control with no WebContent jetsam.
- `scripts/memory/iphone/warm-return.mjs`: the warm-return proof as one
  queued command (cold, then `hop` via robots.txt or `direct`, a 40 s
  hold, jetsam reports and RunningBoard's visible pid per round), for
  DW11's staging run.
- 11-22 phone (serve-local, f12920ad5): `direct` warm returns (one COOP,
  no swap) were killed 2 of 2 at the 1536 MB limit ~12 s after control,
  with no JetsamEvent report, only the kernel's memorystatus lines; a
  `hop` return showed a new visible pid and held 40 s. warm-return.mjs
  now counts the kernel's kills.

2026-11-22 ~20:45 Cancún: the warm-return harness now leaves pages with `location.replace` (as the game's travel, reload-at-spot
and exit do; a replace is never kept in WebKit's back-forward cache) and the preview server's game document says `no-store`
like pages/worker.ts (over HTTPS WebKit keeps no back-forward copy of a no-store main document), so serve-local benches the
same eligibility as staging. The 11-22 runs over serve-local may have returned into a process still holding the cold page.
