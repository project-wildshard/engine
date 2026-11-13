# Engine takes format and wire from npm

NPM-PUBLISH NP6. A consumer installing `@wildshard/engine` from npm
still pulled two git dependencies: `@wildshard/format` as a
shard-format release tag, and `@wildshard/wire` at a commit with a
`path:/packages/wire` subdirectory. Both are on npm now, so the
dependencies switch to the registry:

- `@wildshard/format` is `npm:@wildshard/shard-format@^0.4.9`, an alias
  so every import keeps its name. npm's 0.4.9 is byte-identical to the
  git tag engine had.
- `@wildshard/wire` is `^0.1.0`. npm's 0.1.0 differs from the pinned
  commit only in comments and its `WIRE_PACKAGE_VERSION` constant,
  which engine never reads.

The peers sharddev and the shard repos patch in with
`packageExtensions` (`vite`, `@typescript/typescript6`, an optional
`@types/three`) are now engine's own `peerDependencies`. Consumers run
pnpm with strict peers, so each still lists vite and
`@typescript/typescript6` itself, as sharddev and the shard repos
already do; the extension just stops being needed. A vite or
TypeScript bump moves engine and the shard repos together, as it
already did. `NPM_PIN` takes a semver range only, never a dist-tag.

`wire-released`, WR6's last-release copy, stays a git dev dependency:
consumers never install it, and moving it is a wire-release question.

`format-lock.mjs` learned the registry shape: an npm alias pin locks
by version with an integrity-only row, and the importer's version must
match it. The git-tag rules are unchanged, so a shard repo still on a
tag passes as before. `wire-lockfile.test.ts` now holds the bound wire
to a semver with a registry row and keeps the git subdirectory check
for `wire-released` only.

Checked with a frozen install in a clean copy: both packages resolve
from the registry at the expected versions. The publish half of the
row (attestations on npm) waits for the next engine release.
