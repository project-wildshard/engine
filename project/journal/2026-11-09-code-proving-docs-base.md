# A docs verdict needs a code-proving ancestor

The old workflow classifies only event.before..GITHUB_SHA. A code push that is
red or superseded can therefore be followed by a docs push that skips the full
proofs and goes green. Exact ci and ring-1 success can then authorize a staging
bundle containing code the full suite never proved.

The outer-edge CLI creates a real Git history and a genuinely failing Node
assertion, then runs the workflow's actual classification command against a
local Actions API double. Old behavior classifies that docs successor as safe:
true instead of false, reproduced in 0.245 seconds.

The classifier now requires an actual completed successful push run on an
ancestor, with successful changes, static, plan, test-matrix and e2e jobs.
A docs-only success cannot satisfy that inventory. Classification compares
against this code-proving SHA, not the immediately preceding push. Missing,
malformed, unavailable, non-ancestor or incomplete API evidence runs full.
The verdict summary explicitly names skipped docs tests and their proved base.

The actual workflow-command proof now passes red-code and cancelled-code
successors, refuses a prior docs-only success as code evidence, permits a docs
change after an actual proved fix, and runs full when the API is unavailable.
All five scenarios finish in about 0.7 seconds. No release gate, assertion,
test inventory or runner budget is relaxed.
