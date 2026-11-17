# Sentry hears automated pages (SENTRY-TRIAGE S21)

- Nalati's error card on staging v0.1.33/v0.1.34 ("reading 'bones'" in
  `grid.runtime.<cell>.animals`, then the core render) was met only by agent
  proofs. The card said REPORT SENT: the `/api/errors` inbox got it. Sentry got
  nothing, because `productionPage()` refused any page with
  `navigator.webdriver`, harness pins or a headless user agent, so the SDK never
  loaded. The human path was fine (staging v0.1.32-34 events, screen tags).
- Now an allowed origin always reports. Automated pages report as
  `<environment>-automation`, at most 20 distinct events a page; a screen report
  (the card) skips the cap. `test/sentry-automated-faults.test.ts` drives the
  Nalati pair through `systemFault` and the error modal; red before.
