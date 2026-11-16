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

The first hosted run exposed the real older-kind death selector regression.
After correction, both unchanged declared journeys and 21 combat/harvest/
native controls pass. The complete local CI static code suite passes,
including every standalone proof, hooks and parity. Actual package gates
and actionlint pass for the compiler input graph. The latest-main rebase
then passes fresh pins, game lint, types, CSS, saves and both focused paths.
The retry reuses these completed checks with --no-preflight; normal split
pre-push and exact branch CI remain required.
