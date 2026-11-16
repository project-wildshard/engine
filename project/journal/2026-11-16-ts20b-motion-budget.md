> Written by: Codex
> State: built, hosted qualification pending, 2026-11-16.

Main run 43828373250 spent 61.89 s in motion-traces: 59.25 s in tests and
hooks, 2.11 s collecting. Its eight 40,000-tick traces each replay twice.
The work is serial, not mostly import/setup. Two balanced files now own
page/riding/legacy/versioned and wet/dry/driver/walking. The unchanged
runner lives in one fixture, with the same seeds, ticks, mode checks,
snapshot events, 80 hash checkpoints, replay checks and baseline bytes.
Recording serializes atomic row updates so parallel groups cannot clobber
one another's new hashes. The existing 60 s file budget is unchanged.

Local before: 17.587 s, eight cases. After: 9.526 and 9.821 s, the same
eight original case names and states. A source comparison proves the trace
bodies unchanged; baseline hashes are unchanged. Lint/types pass. The
normal branch CI must still demonstrate both files below 60 s hosted.
