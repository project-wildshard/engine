# public/ holds engine front-end art only (SF12)

Lane opus-public, meta standalone shardfiles SF12 (J525). After SF11 no
pin publishes into `public/`, but engine git still tracked 216 zone files
(124 MB): ground texture sets several zones name by layer, Pine Hollow's
props, each zone's far and near views and the title portraits. Each zone's
re-pack (SF5 to SF9) carries its own copy now, so they leave engine git:
`node src/scripts/public-verdicts.mjs --cut` lists every tracked file on
neither the engine nor the delete list, and that list is `git rm`ed.

The page build copies the engine list and the build's runtime (physics,
Basis, spawn packs), never the folder (`copyDeferredPublic`). The engine
KTX2 map named 150 targets, every one a pin's output; it is empty now, as
a zone's KTX2 is its cook's. Guards: the verdict test fails on any file
under `public/` that is not engine, delete-listed or runtime, and on any
KTX2 map row outside the engine list; the shard-named public path debt
(C0c) is paid and stays empty.

The piano island and pine recordings stay on the engine list (2.5 MB):
shard-format 0.82.3 still names `island` and `pine` as engine slots, and
Driftwood, Mossgate and Mirror Salt play the engine island slot and
Mossgate, Mirror Salt and Pine the engine pine slot from `base`. A cook
fails on an engine name whose file is gone, so they leave only when those
zones play their own sets and shard-format drops the two slots.
