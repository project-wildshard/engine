# The revision stamps leave git (LAND-SIMPLIFY LS1, J250)

The audit of the last 1,000 engine commits found a quarter of them were
bookkeeping, mostly stamps and timings. Timings went in LS2. This commit
takes out the other half: `scripts/renderer-revision.json` and
`scripts/validation-revision.json` are no longer tracked, and nothing writes
them.

**Why no file at all, not the row's `prepack`.** The row planned to write both
files in a `prepack` script so an installed engine could still read them. That
can't work. Consumers install `github:project-wildshard/engine#<sha>`, and
pnpm 10.26+ refuses a git dependency with a `prepack` (release.sh checks for
this and refuses to tag one). So the values are now computed live in an
installed engine too:

- **Renderer** (J259 made this possible): its inputs are client and shared
  source plus four dependency specs, and `package.json` `files` ships all of
  `src` except tests, which were never inputs. With no lockfile, the engine
  walks its shipped `src/client` and `src/shared` instead of listing git's
  files. The value stays `e920f041`.
- **Validation**: it hashed the whole `package.json` and the lockfile, and it
  walked test files too. An installed engine has none of the three. Now it
  hashes the exact `dependencies` and `pnpm.overrides` (format is pinned by
  commit) plus the same source folders, with tests excluded. The value moves
  once (verdicts and product caches redo once). After that, a release's version
  bump no longer moves it, so `release:stamp` is gone. release.sh runs that
  script only if it exists.

Deleted: both stamp scripts, gen.mjs's calls to them, push-selection's
stale-stamp check, and land's stamp handling (`STAMPS`, `regenerateStamps`,
`contentConflict`, the conflict loop). `verifyReplay` now compares whole trees.
The old checkout's copies are ignored.

Tests: `test/land.test.ts` replaces the two stamp tests with a real-git land
across two main commits that each move the renderer revision. It lands
carried, with no stamp line and no `revision.json` on main. The J206 test now
proves land runs no generator after the rebase.
`test/renderer-revision.test.ts` copies the shipped sources into a folder with
no git and no lockfile, and gets the same value.

Codex review (J206): 1 MUST-FIX, fixed. The validation walk hashed
native path separators, and its `localeCompare` order depends on the
locale, so a Windows or other-locale install could disagree with the
checkout. It now uses `/` and code-unit order (value `be033e04`). SHOULD,
done: a `post-rewrite` hook commits during land's rebase, and verifyReplay
stops it; a copied installed helper with no lockfile matches the checkout.
SHOULD, open: dropping the lockfile means a transitive-only resolution
change no longer moves the validation revision (the built-product key still
hashes the lockfile). The one-time key move needs `pnpm pins` in old
worktrees (AGENTS.md).
