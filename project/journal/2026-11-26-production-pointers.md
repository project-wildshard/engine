# Production pointers follow the signed release file

- Meta QA 11-25 row 127 (opus-zs11, from ZONE-SNAPSHOTS ZS11). Promoting v0.1.92 signed `releases/production.json` but
  never touched the API's production pointers: six stayed one release behind. The API's daily prune names every channel
  pointer and keeps three revisions behind each, so the stale ones held eight dead uploads and the strict corpus went
  red. On 11-26 I flipped the six by hand (admin flip, one receipt each).
- `src/scripts/server-release/production-pointers.mjs` now runs in server-release.yml right after production's sign
  step. It reads the signed file players load (so a held publish moves nothing), maps each entry to its upload hash
  through `/api/shardfiles`, flips each pointer that differs, and reads the catalogue again: it fails red when one is
  still off. `--check` needs no token and exits 1 when moves are owed; on 11-26 after the hand flips it read clean.
- The workflow needs the `ADMIN_TOKEN` repo secret (the API's admin bearer, same as `admin.mjs format`).
- Tests: `src/test/production-pointers.test.mjs` on v0.1.92's shape (made-up hashes), and the workflow wiring in
  `test/server-release-ci.test.ts`.
