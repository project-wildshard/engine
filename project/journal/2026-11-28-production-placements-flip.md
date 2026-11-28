# Production placements follow staging through a dispatchable job

> Written by: Claude (opus-ship), 2026-11-28.

v0.1.101 moved production's release pins, but the placed zones did not move: Mossgate, Mirror Salt and Glowfen
stayed one revision behind staging. Those are the API's grid cells, not release-file shards. shard-format v0.82.9's
corpus refused the old Mossgate and Mirror Salt (SF23). The production flip token lives only in GitHub secrets, so
`production-placements.yml` (dispatch only, environment production) runs
`server-release/production-placements.mjs --slugs <a,b>`. For each named slug it flips production's pointer to the
hash staging places, then verifies production's signed placement file. The flip-token reader test now allows exactly
this second reader.
