# LD2, LD3: name the warm check, make the paste readable

Jake's cached reload on production d91507e (engine v0.1.2) took 51.8 s. Start was 35.1 s, of which
`app:selected-discovery` was 34.6 s, and no page request started for 32.1 s. His paste named that
wait only as `resource-N` and `operation-N`. Code order plus that gap point at the tap's spawn
download warm check: v0.1.2 answered `present()` with `Cache.matchAll()` over the whole asset
cache, and every listed read (selected discovery's `discovery.json` first) waits on its own check.
`b9d524b` (v0.1.3) already replaced that census with per-file `Cache.match`. In Mac WebKit,
480 matches cost 36 ms and `matchAll` 0.8 s at 5,480 entries, growing with the cache.

LD2: the check is now a named span, `download:cache-check` with its file count, and a listed read
held while a check runs is a `Spawn download` wait for its path. `entry.ts` lends the waits
registry to the spawn module from the tap, so Start's holds are named before Loading exists.

LD3: Copy diagnostics names this page's own files by path (a query keeps only a content `v`);
other origins, credentials, `blob:` and `/api/` keep per-report IDs. Engine-shaped operation and
wait names keep their names; free text still becomes `operation-N`. The paste opens with a summary:
the slowest page step, the longest span inside it, the longest stretch with no page request, and
the next slowest steps. `exportPrivacy` becomes `own-paths-other-urls-and-free-text-removed`, and
`loading-card-proof.mjs` checks the new value.

Plan: project-wildshard-meta `docs/plans/LOADING-DIAGNOSTICS-PLAN.md` (J208).
