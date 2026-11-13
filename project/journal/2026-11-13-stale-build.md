# A build over three weeks old only updates

> Written by: Claude (opus-oldbuild), 2026-11-13

Jake, 10:25, after a six-week-old October build crashed on his phone: "we must stamp in the actual date and time of
that code, in both the HTML and the JavaScript ... It's clearly more than 3 weeks old. Pop up, go a completely
different path, just a forced update path." (J321, meta `docs/plans/STALE-BUILD-PLAN.md`.)

- **One build time.** `build-app.mjs` fixes `WS_BUILT_AT` once; `version.json` `time`, the documents, the entry and
  `sw.js` all carry that same millisecond (`scripts/app-build/builtAt.mjs`).
- **The entry's stamp is a banner, not a define.** Everything the page imports sits in shared, content-named chunks
  (J217), so a define there would rename a shared chunk every build. The page's own `b/<build>/main-*.js` is per build,
  and with `strictExecutionOrder` its first statement runs before any module body: it stamps, marks a stamp unlike the
  document's, and hands a stale build to index.html's screen and throws.
- **Proof** (headless Chromium on a local build, the clock moved): 22 days shows the screen, unregisters the worker,
  clears `ws-*`, reloads with `?ws-fresh`, stops after two stale reloads; 20 days boots; a clock 22 days ahead with a
  server `Date` of today boots; an address serving the old build says so; offline says connect.
