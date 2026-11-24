# No pull requests in project-wildshard

A release lane opened repo-kit PR #6 on 11-24; Jake: "lets not open
PRs in project wildshard". The new shared PreToolUse hook
`.agents/hooks/no-pr-guard.mjs` refuses `gh pr create`, `gh api`
POSTs to `.../pulls` and a `createPullRequest` mutation when the repo
is project-wildshard/* (by -R, GH_REPO, the api path, or the folder's
origin). Reads, comments and closes pass; ALLOW_WILDSHARD_PR=1 is the
J381 escape hatch. Engine declares it beside its own hooks in .agents/hooks.json.
