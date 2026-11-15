# Box saves tool (buddy-engine, QA 11-15 row 24)

Jake: "why dont you have an admin tool you can run on the VPS to clean
it up yourself ? i shouldnt be running shit."

- `wildshard-config saves list [--production]` prints every player's
  id, name and created_at. `saves delete-test <id>... [--production]
  [--yes]` is a dry run unless `--yes`.
- It lives in `wildshard-config` on purpose: the agents' sudo allowlist
  already names `/usr/local/sbin/wildshard-config` with any arguments
  (J266), so no new sudoers line is needed. It reaches the box like the
  cook verb did: a signed staging release built from this commit, then
  `sudo -n wildshard-apply <tag> harden`, which installs the helper.
- Only test and bot names can go: `r<N><shard>`, `Agent X`, `Bot`. A
  real name, a missing id or a bad id refuses the whole call. The ids
  reach psql only as variables. Every table with a `player_id` column
  loses its rows, then `player`, in one transaction that re-checks the
  names under a row lock. `logger -t wildshard-saves` records each
  delete in the box journal.
- The test runs the script against the real migrations in PGlite
  through the real psql over pglite-socket. It has to use async
  `execFile`, because `spawnSync` blocks the socket server's event loop.
