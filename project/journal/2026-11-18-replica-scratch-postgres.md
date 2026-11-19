# A scratch Postgres for the box replica (opus-mmorefresh)

- Meta MMO-SERVER E7.4b asked for a Postgres restart during play on
  apt Postgres. Staging and production share `postgresql@16-main`, so
  that restart would blip production saves. Jake, 2026-11-18: never.
- `wildshard-config replica start --saves postgres` now makes a
  throwaway cluster, `16 wildshard-replica` on port 5439, socket only,
  `start.conf` manual. Its pg_hba lets postgres in by peer and the
  replica's role by a per-run scram password, which goes to psql on
  stdin, never argv. `replica pg-restart` restarts only that cluster
  while a replica runs on it; `replica stop` drops it.
- `replica.mjs` names no other cluster or database; the test greps its
  source for `16-main`, `saves_production`, `saves_staging` and 5432.
- `mmo-bots.mjs replica --box --box-saves postgres --pg-restart-at N`
  drives the witness: bots walk, the helper restarts the cluster at
  second N, the server's lines carry the save results.
- It reaches the box with the next staging release's signed harden.
