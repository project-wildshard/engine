# The cook runs the migration chain on an original it refuses

> Written by: Claude (opus-compat-w2, P1 for v0.1.67, 2026-11-22)

v0.1.65 and v0.1.66's cook refused Pine r5 (2afc6270, production's pointer): its `compendiums`
predate `journal-glyph-images`, so the format validator refuses the original, though the API
migrates it. J486 says a stored shard that can migrate keeps working with no re-upload, so
`cookJob.admit` now validates the original first and, on a refusal, runs the format chain
(`migrateShardfile`), validates the copy as the API does (`validateMigrated`) and cooks the copy,
built in memory. The original's bytes are never written. A head that validates cooks as before.

Replay on the MacBook: all 26 production heads (release pins plus pointers) admitted; 25 as they
are, Pine r5 through six steps; Pine r5's full cook passed in 74 s (stale preparation warned).
