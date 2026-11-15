> Written by: Codex
> State: built on plan/tc-pins, 2026-11-15.

The latest night (43726101778) passed its dynamic-head plan but could not
load the suite from shallow history. Stored-head boot also parsed later
world/label globals as part of the verdict JSON. Fetch full history and
replace only that JSON assignment, preserving the real stamp's suffix.
Keep error stacks in receipts and restore the existing input-addressed
encode cache for slow hosted builds; head cook stores remain fresh.

Checkpoint those encodes immediately after a successful build, before a
red head can discard the job's post-cache save. The pure input-addressed
cache is shared between Linux and macOS; per-OS keys kept WebKit cold.
