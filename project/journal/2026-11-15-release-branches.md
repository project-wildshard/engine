# Release branches

- RB1: release refs get their own uncancelled CI group. Main keeps its
  normal coalescing; the release-subject exception is gone. Changelog
  checks read release refs too. Nightly promotion prints a release cut
  command and never creates a version tag itself.
- Release commits need matching release worktrees, including dry runs;
  arbitrary branches and detached commits remain refused. The session
  brief recognizes version release refs without hiding stray names.
- MMO landed once at 141c35b491. Its A18 non-wire/no-phone slice is done;
  the remaining wire, identity, phone and VPS witnesses stay in MMO-PLAN.
- Reused that owned checkout for plan/release-branches instead of adding
  a worktree above the cap. Release helper changes wait for RB4 and RB5.

- RB2: staging signs the current green release-branch head, not a main
  push or a delayed older event. Production admits the tag from its
  published release branch or main, retaining its exact release CI proof
  after merge-back deletes that branch. Asset reachability agrees, and
  explicit staging alignment names a release head. The forward-only
  publication rule is unchanged.
- The v0.1.23 engine-main hold is in force while these rows build locally;
  do not start RB4 until its required receipt clears that restriction.
