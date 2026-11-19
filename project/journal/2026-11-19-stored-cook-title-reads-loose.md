# 2026-11-19: a stored cook's title row reads its upload's loose folder

Lane: buddy-engine (keeper; MAIN RED 4de1e703e9..320e5897d4, run 44521588783, boundaries).

4de1e703e (codex-ms, SA48) moved a cook's `shardfiles/` and `programs/` keys into its upload's
`loose/<hash>/` folder only, and taught `addStoredShards` and `shardPackBase` to follow
`CookIndex.loose`. The title row did not: `titleRowOf` still pointed a stored shard's discovery,
shardfile and card at `<base>/shardfiles/<slug>/…`, which the store no longer has. cook-to-play's
boot asked for `shardfiles/brasscap-mesa/discovery.json`, got 404, and stopped at
`start.app:tables-import-and-prepare`. Any build that attaches stored cooks (staging) would too.

`addCookedShards` now hands `titleRowOf` the base plus that shard's `home.loose` folder. The
catalogue-document test gained a loose case; it fails without the fix.

This is half the repair. A local cook-to-play with it reads the discovery from
`loose/<hash>/shardfiles/brasscap-mesa/discovery.json`, then 404s on
`shardfiles/brasscap-mesa/shard.json` (and reads the slug-level discovery again): the page's other
readers (`contentURL` with one global base, `clientWorker`, `runtimeFolder`, `phoneMemoryLine`)
still build `shardfiles/<slug>/` without the upload's folder. Those go to codex-ms, SA48's owner.

The same run's tests (1) was the stale `_template` in the E7 shard variables, fixed by
correcting the variables at 12:13 UTC (that job started at 12:12).
