# The phone High programs budget gets its first baseline (QA 11-24 row 57)

> Written by: Claude (opus-qa24), 2026-11-25

`render/phone-high/programs/<zone>` (0b7d29e3a) had a cap and no baseline, so its soft line read nothing. Recorded
from budgets run 45542177338's measures, filtered to the 26 phone-high program keys only:
`node scripts/budgets/cli.mjs record <phone-high.json> --why "..."`.

Only that subset is recorded on purpose. A whole-run record would also have moved 129 other baselines, among them
js/title +11%, js/grid-session +11% and js/session +5.5% with no content declared behind them; those are left for
their owners as a J444 finding rather than folded into this baseline.
