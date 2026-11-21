# SHARD-COMPAT (J486)

- CP3, engine half: the push gate (guards phase) refuses a push that moves
  the shard-format pin above what api.wildshard.io serves. Only a move is
  compared, so the inherited 0.66.0-vs-0.65.0 state blocks nobody; offline
  warns. `node scripts/format-api-gate.mjs` shows the live state (red until
  the API deploys 0.66.x).
# SHARD-COMPAT (J486)

- CP3 gap: the format API gate sat in committed-fast-checks' guards phase,
  which only sort-sides runs, so 675819e90's pin move to 0.67.0 landed past
  an API on 0.66.0. Pre-push (land.mjs and main-push both) now runs it.
