# A placed cell opens on a running server (SA33)

> Written by: Claude (opus-sa33), 2026-11-13

**Grounding (before code).** Who writes what, read from engine `7205efe` and api-server v0.10.0:

- The release file (`releases/<channel>.json` on R2) is written only by engine CI: `server-release.yml` runs
  `scripts/server-release/publish.mjs`, which signs with the GitHub secret `E7_RELEASE_SIGNING_KEY` under an R2 ETag
  CAS. Its `shards` are `E7_<CHANNEL>_SHARDS` filtered to engine's own `test/pins/shardfiles.json`, and the J234 gate
  holds any file whose shards have no pack in that build's server book. It carries no cells: a server's grid is the
  bundle's baked `singleplayer.json` (`gridCells.ts`; `build-server.mjs` writes `cells.json` from the same file).
- So the release path cannot open an API-placed slug: the slug is not pinned in engine, has no row in the build's book,
  and has no cell in the bundle. And a new release serial always restarts the world: `ReleaseWatch` → `beginGrace` →
  60 s → restart, so every player in every other cell is dropped.
- The API must not sign release files. That key vouches for `bundle` (name and SHA-256), the code the box runs; an API
  Worker holding it could ship any bundle to the box. It needs its own, narrower key.

**What was built.** A second signed file, the **placement file**: `{channel, serial, cells: [{instance, slug, cell}]}`,
signed with the API's own Ed25519 **placement key** (public half on the box as `PLACEMENT_PUBLIC_KEY`, where it is
`PLACEMENT_URL`; both or neither). It can only add a cell on an empty spot of the 7 × 7: it never names a build,
bundle or save epoch, and a placed cell still loads its shard's pack from this build's book, so the book stays the
trust root for what runs. On a `WORLD_CELLS=grid` server, `PlacementWatch` looks at once and then each minute
(`RELEASE_POLL_MS`); for each cell it hasn't opened it calls `placeCell` (one cell a slug, one cell a spot, radius 3,
frame `25 + n`), preloads the pack, and `World.openCells` boots the new cells on a worker of their own, adding them to
the table only once that worker has booted. No other worker hears anything: no grace, no restart. A worker that fails
to boot is let go and ends nobody; a cell whose pack is missing is refused and asked for again next look. Worker
threads get the door's placed cells in `workerData`, since their module state is their own. `/health` gains
`placements` (the believed serial). A restart forgets placements and the first look restores them.

`test/dedicated-placement.test.ts`: signature and schema; `placeCell`'s rules and frames; the watch (only new cells,
retries, never an older serial or another channel); on a room bench, a bot walking in Night Market's cell keeps
receiving frames while Thin Ice opens at (0,3) on a second worker, a second bot is seated there by `?chunk=`, and
`/health` shows 2 cells on 2 workers with no restart or crash; a cell with no pack opens nothing and crashes nobody.

**Left for the live proof:** the API writing the file (next row's spec, in meta SA33); the placement key's two halves;
`PLACEMENT_URL`/`PLACEMENT_PUBLIC_KEY` in the staging env (a `wildshard-config` key, MMO-SERVER MS3.6); a server pack
for the new slug in the running build's book (the cook, MS2.4, is disabled; nothing else writes one); and the client
reading a ring-3 cell (SA34; `DRAWN_GRID_RADIUS` still refuses it).

**Review (one `claude -p`, no MUST).** Taken: a `kind: 'placement'` tag in the signed body, so no body reads as
another kind; a placed instance may not be a grid slug nor a slug a grid instance (it would take that shard's players
and gotos); two opens of one cell at once boot one worker; a signed-file fetch gives up after 30 s so a hung look can't
stop later ones. Left as known limits: once booted, a placed cell's worker is like any (its crash ends the process,
Q77); `seen` starts afresh at each boot, so the API's serial must never go back (its spec says so); a restart's grace
preloads only the release's shards, so a placed cell reopens on the first look after the restart; older workers don't
learn of a placed cell (crossing into it and its chat lines' cell name wait for GC15 and SA34).

## The page half (opus-placedclient, 2026-11-13)

The staging page never learned a placed cell: Thin Ice sat at (0,3) on the box (placement serial 1) but had no Shard Select card, and
`?chunk=open-plot-thin-ice` landed on the deck, because the page's grid is the catalogue its build baked. Now a released page (one with
a world stamp, staging or production) reads `releases/<channel>-placements.json` at boot (`src/client/game/grid/placedCells.ts`),
checks it with WebCrypto under the API placement key and the box's own `PlacementSchema` (moved to `src/shared/game/grid/placementRows.ts`
so both ends read one schema and one key), and adds the cells by `placeCell`'s rules to the installed catalogue before anything reads
the grid. The card shows even for an open plot (`placedByFile`), since with crossing off it is the only way in. A slug the build has no
card or product for stays out. The boot waits 3 s at most, import included; a 404, bad signature, wrong channel, timeout or junk keeps
the build's 25 cells, and a late answer installs nothing. No-store read; the service worker already leaves `/releases/` to the network.

Proof: `test/placed-cells.test.ts`; a local build (no world, so `__WS_PLACEMENTS__` named the live staging file, its bytes handed over
with a CORS header since packs only allows our origins) went title → Shard Select → Thin Ice card → ENTER WORLD → inside
`open-plot-thin-ice`, seat 26, and walked 17 m, desktop and phone. The live walk waits for v0.1.18. Not done: the page keeps no
highest serial (J179); placements only add today, so an older file is a subset.
