# Shard import lint refuses encoded paths (meta QA row 66)

> Written by: Claude (opus-englint), 2026-11-13

sharddev closed this hole in `ef191d3` (its `lint/sdk-plugin.mjs`, journal
`project/journal/2026-11-13-generator-imports-percent.md`) and named engine's `lint/shard-imports.mjs` as the same hole.

**The hole.** Node resolves a relative import as a URL: `./%2e%2e/%2E./other/x.mjs` loads `../../other/x.mjs`, `\` reads
as `/`, and tabs, newlines and edge spaces drop out. `path.resolve` keeps all of them as folder names, so a lint that
resolves the raw path sees a file inside the shard while Node loads one outside it. Engine's `generatorImportViolation`
did exactly that, and so did the two boundary predicates (`shardGameImport`, `shardEngineImport`) and
`no-shard-runtime`'s trusted-runtime check, where an escaped path just looked like no boundary at all.

**The fix, two kinds.**

- `generatorImportViolation` (a refusal rule) takes sharddev's shape: any `%XX` escape, backslash, tab or newline in the
  path part refuses (a `?query` or `#hash` is left alone), and a relative path must name the same file through `new
  URL` as through `path.resolve`, the catch-all for a rewrite not listed (a trailing space is one).
- The boundary predicates answer a question rather than refuse, so they now read a relative path both ways and say yes
  if either reading lands in `src/<side>/game` or `src/<side>/engine`. That also closes a smaller gap: `../game?raw`
  used to miss the `game(?:/|$)` match because `path.resolve` kept the query. `sharddevRuntimeImport` does the same
  for `no-shard-runtime`.

**From the `claude -p` review.** Its first MUST: bake commands and Blender sources sit outside the author folders, and
the layer rules read their imports through the plugin's `modulePath` (plain `path.resolve`), so an escaped path from a
bake file still reached another shard. Rather than teach every `modulePath` user two readings, `generatorImportViolation`
now refuses an escaped path in every `src/shards/` file. Its second MUST, older than this hole: an absolute path or a
`file:` URL passes the layer rules untouched, so outside the author folders those refuse too (inside them they already
did). Two NITs fixed as well: a `?query` or `#hash` on `@wildshard/game`, `@wildshard/engine` or
`@wildshard/sharddev/runtime` no longer hides the boundary, and a folder import of `sharddev/runtime` counts. Left as a
NIT: `./a//b` refuses, because path.resolve folds the double slash and the URL keeps it; that errs strict.

**Left alone on purpose.** `engine-sides.mjs`, `no-generated-import.mjs`, `client-plan-boundary.mjs` and the plugin's
`modulePath` also `path.resolve` a specifier, but they map engine's own reviewed source, not shard author code, and Vite
decodes nothing, so an escaped import there fails the build rather than slipping past. Refusing escapes engine-wide
would be a new rule, not this fix.

**Tests, red first.** `test/generator-import-paths.test.ts` has sharddev's kinds (encoded `..` to another shard from
generators and data, `%2f` slashes relative, in the SDK name and in a `file:` URL, encoded `@wildshard` names,
backslashes, tabs, newlines, a trailing space, a `file://host` URL), the predicate cases, the bake, Blender and
declaration files, and the `?query` package cases; all four tests failed on the old rule. Plain paths, `.`, `../data/`, a trailing slash and `?query` escapes still pass. `test/no-shard-runtime.test.ts`
gets an escaped runtime import, checked by hand with oxlint because that file is lift-pending. `pnpm lint:game` is
clean, and no shard repo has an escaped import.
