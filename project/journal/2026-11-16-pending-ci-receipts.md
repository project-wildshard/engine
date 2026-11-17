# Pending CI runs say why they were skipped

> Written by: Codex
> **State:** implemented, 2026-11-16.

Jake confirmed CIQ1 intentionally replaces pending engine main runs.
The watcher now says `skipped (pending, replaced)` when GitHub's jobs
show that no job started. A started cancellation keeps its existing
superseded receipt, and both still inherit the newer covering verdict.
GitHub's workflow `run_started_at` also exists on zero-job runs, so it
cannot establish that a run executed. Cache the job result per attempt.
