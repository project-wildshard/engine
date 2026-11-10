# Let the live hosts report to Sentry, filtered

Sentry had heard nothing from the game since 11-07: the browser channel
only sends from origins in errorReportOrigins, and that list held only
the old singleplayer Vercel host. play, staging and preview were all
missing, so production errors went to /api/errors and nowhere else.
Jake approved the triage plan (meta SENTRY-TRIAGE-PLAN rows S1 and S6,
J238) and the push rides v0.1.7.

S1 adds the three wildshard.io hosts and an origin to environment map
on the app identity. The engine reads it into sentry.init, so a staging
event says staging instead of every event saying production. The
webdriver and harness gates are unchanged.

S6 lands in the same push so the wider gate never opens unfiltered.
beforeSend now drops extension-only stacks, the debug probe's harness
error, QB8's deliberate test error outside staging, headless and
Playwright user agents (a CDP-attached agent may leave webdriver
false), ResizeObserver loop warnings and an opaque Script error. with
no frames. The rule is a pure function so each case has a fixture.
