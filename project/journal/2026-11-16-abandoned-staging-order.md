# Advance past an abandoned staging release

The v31 cut request exposed a publisher blocker before deployment:
staging serves unmerged v30 f8ff9bd9, while the required fixed main
descends from its source cut but not its version-only release commit.
The raw ancestry gate would refuse v31 as unrelated history.

Keep production's ancestry rule. Staging can additionally advance
between two exact published prepared release tips only when the new
version is greater, both source cuts are on published main, and the
new cut contains the old cut. Both tips must change only version and
changelog from their cuts; the rest of each manifest must match. Any
release-only code or dependency change requires actual ancestry.
This preserves v30's branch and record without merging or tagging it.

The real Git fixtures cover forward and reverse versions, same-cut
updates, source regression, unrelated or unpublished cuts, a moved
release ref, release-only code and manifest changes. The real S3 HTTP
boundary proves that the successor still waits for packs, advances
once, rejects reversing the move, and cannot use this rule for prod.
All 12 focused tests pass; normal lint/types and push gates follow.

This is a prerequisite of MINI-UNBLOCK MU12. The v31 watcher is stopped
until this fix is pushed; its SHA joins the required cut ancestry.
Both tapped J386 staging journeys still gate production.

The normal split push gate passed 138 tests, lint and typecheck, then
lost a main push race. main-pull safely rebased the publisher fix;
the retry uses normal gates. Jake also added SB25 as a hard cut
prerequisite. The guarded watcher waits for buddy-engine's actual fix
receipt before checking required ancestry and hosted green main.

J323: the canonical attempt was withdrawn before publication. The
canonical checkout is clean. This saved patch is now delivered from
engine-quickfix mode1 after buddy-engine published SB25 9ad13112.
Its five in-progress CPU diagnostic paths were left untouched.
The focused release tests pass again on the SB25 source.
