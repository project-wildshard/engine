# Register the real recovery browser proof

> Written by: Codex
> **State:** fixed locally, 2026-11-17; main CI proof pending.

The Far Reach repair branch's first hosted run 44118674108 exposes
another failure inherited from main: tests (6), job 134163695559,
fails the existing real-browser inventory guard. The newly added
staging-smoke-recovery test launches Chromium but is absent from
scripts/push-local-split.mjs BROWSER_TESTS.

The unchanged guard also fails on canonical main before the repair.
Register that one file with the existing browser cohort. Keep the
guard, browser proof, opt-in execution and all budgets unchanged.

M2/M10: repair the actual failing main guard through normal main-push.
The independent M13 pin branch remains held while this repair lands;
its original red is retained rather than rerun away.
