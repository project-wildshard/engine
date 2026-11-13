# 2026-11-13 every error screen reaches Sentry

Jake (~10:15 Cancún): "Every time an error modal opens, are we writing something to Sentry that we can pull down
and audit?" Two of his screens this morning never arrived. The http title (QA row 5) could not report: a plain-http
origin is not in `errorReportOrigins`, so `captureBrowserError` returned before anything. The 14:48 Driftwood drop
notice left no event and no client-side drop in Sentry's outcomes for that hour, so it was never sent either: the
same http origin is the likely cause, and a failed `@sentry/browser` chunk load would also have silenced every later
report on that page (the failed import was cached as "no SDK").

Now every error screen sends one event tagged `screen` (`error-modal`, `stuck-step`, `glitch-chip`, `load-failure`,
`title-drop`, `link-lost`, `link-refused`; `ERROR_SCREENS` in `telemetry/browserErrors.ts`). The report is written
to a device outbox in the screen's own turn and leaves it only on Sentry's 2xx; the next document resends it with
the same event id, so a reload or a killed page still delivers it once. A failed SDK load is retried. Pull them down
with the Sentry query `has:screen`, or `screen:title-drop`.

The drop notice also showed the same 14:48 drop again later: a quiet take keeps the device copies (another tab's),
and a later page that died read the old Playing step back. A `drop.seen` mark now shows each drop once.
