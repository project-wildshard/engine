# Keep pending payouts stable across mixed owners

> Written by: Codex
> **State:** built locally, 2026-11-16; hosted M1b proof remains open.

The final review exposed a valid save round-trip edge: a kind shared by
an undeclared native row and a declared program row can change a newly
saved pending payout during restore. Two independent controls reproduce
red before the fix. Resolve and save every new pending payout at death,
including compatibility payouts. Explicit saved values then win normally.
For truly old dropless rows, mixed absent/declared owners are ambiguous
and refuse before any pending state changes, regardless of row order.

All12 harvest controls now pass, with full types/lint and both real old
native product/save replays. Existing saved drop grammar is reused;
source recipes, RNG, reach, pack policy and duplicate-claim law stay put.
The initial M1b land was intentionally stopped before any branch push
for this correction; no hook escape hatch or CI bypass was used.
