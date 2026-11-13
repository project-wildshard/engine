# The stale-build screen reaches Sentry, from the next build

STALE-BUILD SB6. The stale-build screen is an inline script in
`index.html`: it runs before the entry, so no module, no save service
and no Sentry. It already left a note in localStorage `ws-stale-build`
(build, built-at, the server's build, tries, when) before sending the
player to update.

Now the next build that boots takes that note once and reports it as
screen `stale-build`, through S13's screen outbox, so the report waits
on the device (`screen.reports`, a save-service slot) until Sentry
acknowledges it. The build tag is the stale build's, and the diagnostic
carries built-at, seen, the server's build and tries.

Raw storage is lint-banned outside `engine/saves/`, so the reader lives
there (`saves/staleBuildNote.ts`): it removes the note as it reads it,
drops a malformed one, and returns nothing when the removal fails, so a
stuck note can't report on every boot. The inline script stays as it
was, writing no save-service document. `telemetry/staleBuildReport.ts`
builds the report; `bootTrace.ts` calls it in the same 8 s timeout that
flushes the outbox.

Tests: `screen-reports.test.ts` walks the new screen (one report for two
boots, note cleared) and the malformed and stuck notes.
