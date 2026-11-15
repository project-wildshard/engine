> Written by: Codex
> State: built on plan/tc-pins, 2026-11-15.

Nightly 43763273085 reached the real suite after the history fix, then
exhausted its 25-minute process window before Vitest wrote JSON. Partition
the admitted suite across two Linux jobs with the same per-job bounds.
Verdict v2 requires both exact-SHA partitions, refuses missing/duplicate
parts and overlapping files, and shows actual file/assertion counts.
Existing v1 verdicts still provide the previous night's failure baseline.
A suite-only branch diagnostic proves this without repeating cold cooks.
