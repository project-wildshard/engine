# 2026-11-19: the staging cook's two stalls

Lane: buddy-engine (Coordinator P1, staging cook gave no verdict from about 04:22 UTC).

**One shard every 7.5 min.** Every publish listed the whole R2 bucket to count its budget and
to skip fresh keys: 999,467 objects, 368 s from the Mac, about 6 of each 7.5 min on the box.
The cook takes fresh uploads first, but sixteen open-plot uploads (02:20-02:44 UTC) were
fresh too, so sunscar, glowfen, mirror-salt and brasscap queued behind 16 x 7.5 min. The
worker now keeps one listing for 20 min and adds its own PUTs to it; it lists again only
when the kept listing says over budget, or once it is old. The test counts `list('')`: two
publishes, one listing (it was two).

**"game acknowledgement waiting" forever.** 22 uploads since 15:14 UTC 11-18, none ever
acknowledged. A read-only look at the API's rows: every waiting one is a slug the build's
own catalogue grid holds (nine-dragon-stack, template, driftwood-isle, nalati, sunscar and
16 open plots), `place = true`. The API's signed placement file names only the cells the
baked grid lacks (api-server `placementCells`, SA33a), and the game's activator required a
row for the slug, so it threw "Placement does not publish the upload hash" on every retry.
The activator now falls back to the catalogue's own cell (`catalogueCell`, matched through
`shardSlugOf`, so `template` finds `_template`) with the upload's hash; `placeCell` already
moves a catalogue cell's hash (SA47) and `activateCells` pushes it to the workers.

The cook's log line now carries the game's reason (the 503 body's `reason`, prefixed with the
channel for a non-staging one), so the next stall names itself instead of a bare "waiting".
