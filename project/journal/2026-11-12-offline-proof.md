# 2026-11-12: the offline proof, red first (OFFLINE OF1)

- Meta `docs/plans/OFFLINE-PLAN.md` (J298): staging and prod load from
  cache and then show the connection card; preview plays offline. Every
  OF row's done-when runs `scripts/offline-proof.mjs`.
- One build, two loopback origins. Preview-like is the build as built.
  Staging-like is the same bytes behind a proxy that stamps `__WS_WORLD__`
  into the document and into `sw-core/<hash>.js`, the worker's own copy
  that answers every navigation (stamping only the HTML left the worker
  serving an unstamped page, which then played solo).
- No `context.route`: routing turns off Chromium's HTTP cache, which made
  preview's offline START fail on files a phone keeps. The proxy serves
  staging's signed release file itself, so the CDN's missing CORS for
  localhost needs no route; the door is a `routeWebSocket` stand-in.
- A staging-like load never seats, so the worker's precache (which waits
  for control) may not run: the warm phase is two visits, the second
  reading through the worker.
- The rules live in `offline-proof-rules.mjs`, pinned on a saved log by
  `test/offline-proof-rules.test.ts`. Never in CI.
- Review folded (claude -p): the load error screen, a proof error, a
  resume never offered and an offline read reaching the proxy are red;
  `ERR_ABORTED` is not a failed read; the door is always routed (offline
  closes it); START's first reads are tagged with the card, not the
  title. With one entry at a time the proxy goes offline too, so a read
  the CDP emulation missed fails as on a phone. `--require-world` is for
  OF5 and OF9. Shards off the deck go in by their deep link.
