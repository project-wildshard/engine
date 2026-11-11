# LD6b: a code change renames only the chunks it changes (J217)

LD6 put every non-entry chunk in the shared `/b/c/` folder by content, so a rebuild of the same tree keeps every chunk
URL. A real code change still renamed most of them: each chunk named its imports by their hashed file names, so a
leaf module's new hash changed its importers' bytes, then theirs, up to the entry. On the LD6 measure (code files under
`/b/`, by bytes, same URL after the change) a one-line string change in `src/client/game/engineStrings.ts`, whose
chunk 65 others import, kept 28.6 % of 9.0 MB.

Vite 8's `build.chunkImportMap` (on Rolldown's `experimental.chunkImportMap`) writes imports as stable keys and puts
one import map in each document that maps keys to the hashed files. With it on, the same change keeps 98.7 %: 131 of
134 files, and the three that move are the changed chunk and the two per-build entries. A change in a leaf inside the
largest chunk (1.6 MB) keeps 82.6 %; that is the floor this design has, the changed chunk itself.

What else had to hold: the preload helper resolves its dependency keys through `import.meta.resolve`, so it preloads
the real files; the HTML `modulepreload` links, the boot module bank, the warm check and the service worker precache
all name real files from the manifest, as before; module workers and the standalone shell are separate bundles with
direct imports and no map. The deploy carry still works by files: an old tab keeps its own document's map, which names
its own files, and the carry keeps those. `scripts/app-build/importMap.mjs` checks every build: one map per page
document, before any module script or preload; every row names a written file and no key shadows one; every literal
request in every page chunk reaches a file directly or through the map. `test/chunk-import-map.test.ts` builds a small
graph twice and proves a leaf change renames only its own chunk.

Cost: the map is ~11 kB inline in each document, and Safari before 16.4 (no import maps) can't boot the build. Plan:
meta `docs/plans/LOADING-DIAGNOSTICS-PLAN.md` LD6b.

Timings: `test/chunk-import-map.test.ts` runs in about 0.1 s; its clocks are in the weight tables.

Review (Codex, J206): no must-fix. Two shoulds, both done: dynamic import literals are decoded by the parser, so an
escape or `$` cannot hide a request; and the worker and shell bundles under `/b/` are checked too, by direct files
only, since they run without the map. The check moved to just before the service worker, once every bundle is written.
