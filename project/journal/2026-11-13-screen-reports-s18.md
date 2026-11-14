# The last four fault screens report themselves (SENTRY-TRIAGE S18)

S18's first site was the loading card's RETRY (`loading-stall`). This
commit does the other four, so every screen a player sees because
something went wrong now sends one Sentry report naming itself:

- `stale-reload`: the RELOADING cover when this build's files are gone
  from the server. `reloadIfStaleBuild` reports just before the cover
  goes up; the screen outbox carries the report across the reload.
- `self-reload`: index.html's 12 s self-reload has no Sentry. It stamps
  session `boot.selfReload` with `Date.now()`, so the page it reloads
  into reports it at the 8 s boot mark, but only when the stamp is less
  than 3 s older than this document. stuck.ts and chunk recovery write
  `'1'`, never a time, so their claims never read as this screen.
- `save-failed`: SAVE FAILED, RETRY at a border, from the shimmer's
  status poll; once a session, so an offline player who keeps trying
  can't fill the 8-report outbox.
- `cell-unavailable`: a Shard Select UNAVAILABLE card, from
  `refuse()`; once per cell a session. The engine-words lint refuses
  "shard" in engine code, hence the cell name.

The three common-on-a-bad-network screens are warnings, not errors;
`save-failed` stays an error because a save that won't land is real.

The walk in `test/screen-reports.test.ts` covers all four. The
stale-reload walk needed the browser save environment installed (the
test default is memory-only, which refuses every write) and holds
`leaveAfterPaint`, so it can see the report came before the reload.

The review caught two real bugs in self-reload. stuck.ts's retry
stamps `boot.selfReload` with a time too (not '1' as I first
thought), so its reload read as index.html's; it marks its reload,
which index.html's script never does, so a marked reload passes no
claim now. And an online boot's settle clears the claim within
seconds, so it is read at boot, not at the 8 s report. lastEnd and
entry.ts both call `inspectPreviousBoot`, so the reading and the
report are once a page.
