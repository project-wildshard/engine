# DEL9: pins never name a deleted shard

> Written by: Claude (opus-del9e)

- SHARD-DELETE DEL9's engine half (meta J310). The API half (api-server `db39513`) already refuses grids, flips and
  migrate jobs for a deleted slug; a deleted slug also leaves `GET /api/catalogue`.
- `pins.ts refresh` used to rebuild the pins from the catalogue, so a deleted shard silently dropped out and broke
  whatever still named it later. It now refuses, naming each slug and who names it (a pin, the default release pair, a
  set `E7_*_SHARDS`, or the live document), until `--drop <slug>` says the drop is meant.
- The check itself is `scripts/pins-catalogue.ts`: offline in `test/pins-catalogue.test.ts` against
  `test/pins/catalogue.json`, online as `node scripts/pins-catalogue.ts check` in ci.yml job 1 with both GitHub
  variables. It runs before `pnpm install`, so `servedSlug` and the default pair moved to the dependency-free
  `server-release/served-slug.mjs` (sign.mjs re-exports them). An API outage only warns.
- Surprise: the release variables say `_template` while the catalogue says `template`; names compare by served folder.
