# The nightly keeper: a release nightly under a day old

Meta QA 11-25 row 142. v0.1.96's tag push needed a named --no-verify, and the
planner read it as "the nightly has not run since 11-25 17:58 UTC". The schedule
is not disabled and the cron has no typo: nightly.yml is on `17 7 * * *` and has
been since the lift. GitHub fires it 7 to 11 hours late on this repo: every
scheduled run 11-08 to 11-25 started between 14:10 and 19:14 UTC, with gaps up to
28 h (pins-mirror's six-hourly cron fires two or three times a day too). At 12:15
UTC on 11-26 today's 07:17 run simply had not come.

TC22 itself had no age or coverage check. It took the newest completed release
nightly, however old. For v0.1.96 that run was 17.8 h old at the push and its head
is in the tag, so the hold was its red verdict (the mirror-salt boot that 783f7da91
fixed, plus row 144's 34 WebKit "Expected one receipt, got 0"), but nothing stopped
a two-day-old verdict from judging a tag either.

The fix: nightly-keeper.yml runs on every push to main (and every four hours as a
fallback) and dispatches a production `nightly release proof` when no release
nightly started in 20 h, the same move preview.yml made off GitHub's cron. TC22 now
holds a verdict over 26 h old, or one off the tag's line (its head must be in the
tag, or the tag adds only `chore(release)` stamps past their fork). It does not
demand the tag's own commit: that would put the nightly's 80 minutes in every train.
The alarm: main-watch writes one `main NIGHTLY STALE newest <run>` receipt when no
release nightly started in 26 h, so a broken keeper is seen, never silent.
