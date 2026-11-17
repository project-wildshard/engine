# Keep the J400 guard aligned with Nine's gate

> Written by: Codex
> **State:** fixed locally, 2026-11-17.

Main run 44027299222 at 34fef7a823 failed tests (6) because the
J400 workflow assertion still required exactly three top-level jobs.
NB6 deliberately added the blocking nine-ring1 observation. The
workflow was correct; the exact-name assertion was stale.

Allow Nine's observation and optional separate build beside the
original jobs. Retain the exact remaining job list, all nine packed
shares, T1 artifacts, blocking failures and reporting-workflow checks.
Require the packed tests and products jobs to start independently;
Nine may consume products without delaying those original jobs.

The original focused case failed first against both the published
single Nine job and the peer's pending split build/observation layout.
All 66 cases in test/land.test.ts then passed in 94.17 seconds.
The normal push gate caught an optional regex capture in the job-name
filter; handling that capture explicitly retains the same assertion.
Only this test and journal belong to codex-tc48. Peer workflow and
native-residency edits remain outside this fix. No pins or bypasses.
