# SENTRY-ZERO (opus-sentry, 2026-11-23)

Meta plan: `docs/plans/SENTRY-ZERO-PLAN.md`. Jake: the 5000-event Sentry quota ran out; "Everything in sentry MUST be a bug".

- SZ2: one send policy for the browser (`telemetry/sendPolicy.ts`, applied in `captureBrowserError` and the SDK's `beforeSend`).
  Warnings never send; production and staging only; agent sessions on a 1% sample; one event per fingerprint per tab session
  (sessionStorage ledger), at most 10 a session. The month's spend was 81% warnings and 78% agent sessions, mostly the
  `map-tile-missing` warning screen that S21's automation cap exempted.
- SZ2b: the loading card's 20 s `boot.slow` note is a warning (trail only); wrapped network failures are noise; a page reports its
  first missing KTX2 stand-in only (WILDSHARD-GAME-BV sent 180 in 7 min, one per model).
- SZ3: the rooms server sends one event per kind an hour, at most 20 an hour, never warning or info.
- SZ7: `scripts/sentry-funnel.mjs` (+ test) refuses a Sentry capture outside the two funnels and any warning/info level;
  `scripts/sentry-weekly.mjs` lists unresolved issues over 5 events a day (API token, or `--json` from the MCP).
- Build-max C1: main-watch's fallback and keeper go to the coordinator's pane (w2:p5), not the retired buddy-engine.
- Build-max C4: a test holds every local QA leg (gate target, journey card) inside the shards openQaRig hosts.
