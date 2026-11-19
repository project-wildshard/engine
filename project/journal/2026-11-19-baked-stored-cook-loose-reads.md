# 2026-11-19: a baked stored cook's page reads follow its upload folder

Lane: buddy-engine (keeper; boundaries MAIN RED since 4de1e703e, runs 44521588783, 44522230856,
44523529307; codex-ms handed the runtime half to this lane at 12:36 UTC).

4de1e703e keeps a cook's `shardfiles/` and `programs/` only under `loose/<upload>/`. 627b4d5a0
pointed a stored shard's title row there, but the page's other reads of `/shardfiles/<slug>/`
(the spawn download's loose members, and every read that falls through the member layer) still
went to `<home>/shardfiles/<slug>/` and 404'd: cook-to-play's Brasscap died on `shard.json`.

A placed slug (one uploaded after the build) already had this, `placedLoose`. A stored cook the
build baked names its folder in `spawnManifests.home.loose`; `bakedLoose` reads that (parsed
once per bank text), and both places that asked `placedLoose` now ask either. Slugs without a
loose folder, and the page's own shards, read as before. `test/baked-stored-loose.test.ts`
proves it through the member layer (its own file: the layer keeps the first fetch it wraps);
it fails without the fix.

Gotcha for the next lane: `cook-to-play.mjs` builds the client from `git archive HEAD`, so an
uncommitted client change is not in its build (its scripts come from the working tree).
