# Retire the abandoned v0.1.30 worktree

Jake asked to remove the release tree now: v0.1.30 is abandoned for
production and the engine worktree cap is six. Staging serves the
deployed Worker, so keeping its local checkout buys nothing.

The tree was clean at f8ff9bd967a96acd4769864465f09914d7596055.
A plain `git worktree remove .worktrees/release-v0.1.30` removed it;
no force, branch deletion, reap, release finish or deployment ran.
The local release branch and origin tracking ref still name that SHA.
The release commit retains its manifest and changelog; the prepare log
and v0.1.31 tooling in `tmp/codex-ms-v029/` remain intact.

After removal six linked trees remain, exactly the cap: brain-state
was also removed by another lane during the check. A19 receipts this
cleanup; meta MINI-UNBLOCK MU12 still owns the v0.1.31 release.
