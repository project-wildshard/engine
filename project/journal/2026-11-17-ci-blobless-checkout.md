# Keep historical blobs out of CI setup

> Written by: Codex
> **State:** fixed locally, 2026-11-17.

Main b562155cb9, run 44137015477, failed tests (2). Checkout's
unfiltered all-branches/all-tags fetch took 460.287 seconds. With
remaining setup and pins, each shard inherited about 523 seconds
before it started. Shards 11, 13 and 9 consequently hit the unchanged
600-second hard wall after about 77 seconds of actual execution.
No assertion failure was reported in those unfinished shards.

Set the pinned checkout action's supported filter input to blob:none
for the packed tests job. Keep fetch-depth zero, all source files,
history checks, credentials policy and every time limit unchanged.
Historical file bodies can be fetched when a checker needs them.
Engine is public, so those on-demand reads need no retained token.

The real-Git regression derives clone inputs from the actual workflow.
It failed first because the old checkout eagerly fetched an obsolete
blob. After the fix, the current source is readable, merge-base still
finds the complete history, and the old blob stays deferred. The real
storage checker then fetches the missing intermediate archive and
refuses it, even though the tip deleted it. All 14 storage and shard
wall cases pass in 8.12 seconds; typed lint passes for the test file.

The same run's street job remains advisory under the existing NB6
policy. Its undefined.at diagnostic crash is the already recorded NB6
follow-up; this change does not alter its policy or measurements.

Pinned action input contract:
https://github.com/actions/checkout/blob/3d3c42e5aac5ba805825da76410c181273ba90b1/action.yml
