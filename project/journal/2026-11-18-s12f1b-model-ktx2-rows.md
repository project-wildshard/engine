# 2026-11-18: a model's own KTX2 reads its phone row (S12f1b)

Meta SHARD-SOURCE S12f1b. Pine's glTF prop recipes (hatchet, fire pit,
wine barrel, bucket, crate) name their 1k UASTC maps themselves, so the
cook's 6x6 phone file for a map never reached the phone: three's KTX2
read fetched the URL the recipe named. `tierUrl` now looks a `.ktx2` up
in the tier's table too, after normalising three's resolved URL (an
absolute same-origin URL, or a path with `..` left in) to a path. Pine
keys a phone row by each map; the cook moves its target to the 6x6 file
as it does for any KTX2 row, so the cook itself needs no glTF path.
