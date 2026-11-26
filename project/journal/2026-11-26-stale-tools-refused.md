# A lane refuses tools older than the lockfile (opus-rel86, QA 11-25 row 92)

- After I pulled the lean move (`f928fdae2`) into engine-quickfix, its node_modules still held npm-bin-deps 2.1.0. The
  lean move pinned 2.2.0 and set `binDependenciesProjectSettings: false`. The old runner ignores that setting. Run by
  the next commit lane or main-push's first step, it rewrote the three tracked `.bin-deps` files from the repo's pnpm
  settings, byte for byte the pre-lean content.
- They came back the normal way: once main-push had installed 2.2.0, `pnpm exec npr tsc --version` rewrote them, and
  `git status` was clean with the kit cache profile's hashes. No git restore and no override were needed.
- `checkBinPins` (row 56) names this case but nothing calls it locally. The commit and push lanes
  (.githooks/run-checks.mjs) now read `installLag` before any tool runs, and refuse while node_modules is behind
  pnpm-lock.yaml: "Run pnpm install (or SKIP_CHECK=1)". main-push and land install first, so they never meet it.
- .githooks/lanes.test.mjs moves a sandbox's lockfile past its install, then checks that the commit is refused, no
  lane script ran and no tracked file changed, and that the commit passes once the install is current.
