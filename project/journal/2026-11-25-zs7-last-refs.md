# Ink Cel Valley and Pastel Plain leave engine (opus-rel86, ZONE-SNAPSHOTS ZS7 second half)

- ZS11 deleted the two proof zones' uploads, so the rest of their names go: GATHERED_SHARDS, OFF_PLAYER_LISTS, the platform
  ratchet's exemptions, the snapshot guard's RETIRED list, worker-client-play's pastel `data` smoke (the flow stays, booting Brasscap Mesa, since two declared-death rows in lint/page-events.json name it), their memory ledger and
  armed rows, 18 grid-crossing ratchet pairs, their baked far views (10 files) with their boot-publication rows, their
  manifest-closure rows and their gitignore lines. The zone-select test's off-list case now uses blender-template and f30-clean.
- Kept on purpose: test/engine-lift-disposition.json records the original tests and owner proofs at fixed revisions (history,
  not a live list); test/pins/zone-select.json is the API's listing and drops them at the next pin after the API prune;
  the lint/ debt and pin rows that still name them are outside this row's scope (test, scripts, src) and left as they are.

# A kept listing serves while the prefetch runs (opus-rel86, FR-A2 follow-up)

- v0.1.87's cook (7821582d1) started a prefetch once its listing was half its age, and a publish then waited on that
  prefetch instead of using the kept copy: every publish paid a whole listing (616.6 s from the MacBook in placed-ready,
  835.8 s on the box). A publish now uses the kept listing while it is under LISTING_MAX_AGE_MS old, or under twice that
  while a refresh runs; `current` keeps the PUT rule safe at any age. Two tests hold a prefetch and prove the publish goes on.
