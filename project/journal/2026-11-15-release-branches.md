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

- RB3: only a tagged release merge on the advertised main tip can reuse
  release CI, and only when its tree changes version and notes. Code or
  other manifest edits keep the normal gate. Managed release-branch
  deletion sends no commit and needs no suite; main-watch still follows
  the merge-back's main CI with a clean Git environment.

- Transition: v0.1.23 is already preparing on main under the coordinator's
  hold. Preserve explicit staging alignment for an exact version prepare
  commit published on main with matching manifest and green CI. Automatic
  main CI events stay outside staging; ordinary main commits cannot use
  this exception. Its staging asset admits that same prepared source.

- One-shot review used the repository wrapper's read-only Codex fallback
  because Claude quota was unverified. Two MUSTs: the publisher CLI still
  required main ancestry after source selection, and the helper's prepare
  body exceeded 72 columns. Admit the published release source at the
  publisher while retaining publishChannel's forward-only rule; wrap the
  helper body and prove preparation through the actual commit-msg hook.
