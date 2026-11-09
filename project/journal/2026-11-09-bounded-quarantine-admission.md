# Enforce the quarantine clock against Git history

The old loader accepts a parseable deadline beyond forty-eight hours. The actual
policy CLI proof commits an admission and then extends its deadline to hour49;
old --list still succeeds, reproduced in 0.03 seconds.

Every entry now requires its explicit addedAt, a deadline after admission and
at most48hours later, and no future admission. Blocking discovery still restores
the file automatically at expiry. The policy owner supplied the nine real
admission timestamps in d0f800b; this lane changes no policy entry or deadline.

The new blocking history check follows the policy's committed first-parent
lineage and records absent-to-present transitions. Rewriting addedAt while a
file remains admitted cannot restart its clock: the timestamp must match the
introducing commit. Shallow or unavailable history refuses. Both CI changes
and Ring1 static run this validator with a full checkout, even on docs pushes.
Remote failed quarantine cohorts also emit owner/deadline error annotations.

The outside-hook proof uses the real policy CLI and real Git commit dates. It
refuses hour49 and a forged restart date, accepts the actual introducing date,
and retains automatic expiry. Current committed policy passes for all nine
entries. No assertion, case, file or shard deadline is extended; no new test is
quarantined and no removal qualification is invented during the Actions outage.
