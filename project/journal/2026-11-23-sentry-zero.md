# SENTRY-ZERO (opus-sentry, 2026-11-23)

Meta plan: `docs/plans/SENTRY-ZERO-PLAN.md`. Jake: the 5000-event Sentry quota ran out; "Everything in sentry MUST be a bug".

- SZ2: one send policy for the browser (`telemetry/sendPolicy.ts`, applied in `captureBrowserError` and the SDK's `beforeSend`).
  Warnings never send; production and staging only; agent sessions on a 1% sample; one event per fingerprint per tab session
  (sessionStorage ledger), at most 10 a session. The month's spend was 81% warnings and 78% agent sessions, mostly the
  `map-tile-missing` warning screen that S21's automation cap exempted.
