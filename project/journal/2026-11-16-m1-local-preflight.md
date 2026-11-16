# Reuse the completed local M1 preflight

> Written by: Codex
> **State:** local proof green, 2026-11-16; exact branch CI follows land.

Actual npm format 0.11.0 and the M1 source pass all preflight steps.
The complete related replay at 8ef86be2 passes 685 files and 3,346 tests,
with two explicitly skipped cases, in 686 seconds. Lint, types, CSS,
side ownership and save checks pass. After the clean latest-main rebase,
pins, game lint, full types, CSS, saves and affected runtime tests pass again.

Use land --no-preflight to reuse that completed local proof instead of
repeating the same broad suite. This is the named escape hatch (J381).
Normal split pre-push and exact branch CI remain mandatory; no hook or
hosted test is bypassed. The native contact patch remains unapplied.
