# Keep advisory CI work outside the main verdict

> Written by: Codex
> **State:** prepared, 2026-11-16. Mini M1/M2 forward fixer.

The timings collector repeats the blocking test jobs' AMBER lines.
Read those lines from their original test jobs only. Exclude timings
and quarantine from main's failing-job summary; both have explicit
advisory workflow policy. Keep the workflow's actual conclusion and
all blocking test annotations unchanged.

The quarantine list is empty. Read the actual validated policy before
Node setup, classification, dependencies and pins. An active entry
still takes the original complete cohort path; expired entries stay
in the blocking suite. No file, assertion, budget or gate is dropped.

Work directly in the canonical engine main checkout (mini M1/M2).
No plan branch, worktree or hosted qualification wait. Fix main red
or AMBER forward; dedicated-zone-enter belongs to mini-fixes.

The next shared push included the new concurrent main-push helper.
Its24 typed-lint errors blocked the normal clean-copy gate. Fix the
actual helper under M2: explicit lengths, proper error name, hoisted
formatter, nonempty no-op comments and structured argument parsing.
Preserve empty-string error fallback semantics; do not suppress rules.
