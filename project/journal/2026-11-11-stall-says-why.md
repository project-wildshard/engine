# A stuck start says why

Meta SENTRY-TRIAGE S4. A "stopped loading" report carried only the step
name in its message, and `bootDiagnostic()` returned `{}` when no boot
trace was current, so a stall in Sentry could not be read.

Now the stuck-step watch (and a start that fails before its own fatal
boundary) attaches `stall` to the report: the card's step, its last 8
step rows, spawn files done and total, bytes read and streamed, the setup
share, `navigator.connection.effectiveType` and the page's visibility.
`stuckContext` builds it from the card's data attributes and its
`.ws-load-log` rows; it reads no storage. With no boot trace,
`bootDiagnostic()` now says `trace: none` and where the card stood.

The stuck-step watch's PLAY rule (`36dccbe`, LOADING-SCREEN's) is
untouched. S4 closes when a real stall reaches Sentry with these fields
and 7 days on v0.1.6 or later show no "gap" stall while PLAY was up.
One Codex review (J206, read-only): a MUST (step rows could carry a query token: every query and fragment is dropped) and a SHOULD (the context read is best effort), both folded in.
