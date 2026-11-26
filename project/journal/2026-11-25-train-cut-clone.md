# The train runs its legs from its own clone at the cut (opus-rel86, QA 11-25 row 88)

- The lean move (`f928fdae2`) renamed `scripts/` to `src/scripts/` in the canonical checkout. v0.1.93's train had ended
  at 04:41 UTC, before the move at 04:47 UTC, so it was not affected. A running train would have been: its local QA ran
  `browser-lane.sh` and `staging-qa.mjs` from the canonical checkout, so a pull mid-run changed or removed the scripts it
  ran, and local QA's own source check refused once canonical main moved past the cut.
- `cutTree` (src/scripts/release-train-proof.mjs) opens the clean `--shared` clone of the canonical checkout at a sha,
  pushing to its origin, and refuses a clone that moved or is dirty. Local QA now runs from `cut-tree` at the green
  source, and staging from `stage-tree` at the build (the staging clone code moved into the same helper).
- The train driver loads every module at start, so a move later does not reach it. The repo-kit prepare still runs with
  the canonical checkout as its cwd: it reads only git and its release worktree at the cut, and the client archives run
  in that worktree. Only git, gh and the repo-kit run there now.
- test/release-train.test.ts clones a temp repo at a cut, moves and dirties the canonical checkout, and runs the cut's
  script from the clone. It also reads release-train.ts and fails if a leg other than gh or the repo-kit is spawned in
  the canonical checkout.
- The lean move missed one path: the local QA rig imported `scripts/online-rig.mjs` from its gate copy. It now imports
  `src/scripts/online-rig.mjs`; the rig and its copy are the same sha, so no fallback is needed.
