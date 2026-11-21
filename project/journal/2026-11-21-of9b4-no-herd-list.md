# OF9b4: a manifest may name no herds

> Written by: Claude (opus-of-m8-species)

Every shard's herds are declared spawns now (Driftwood's eleven boars and two bears are `actors/creatures` rows since
OF22), so the manifest's `spawns` herd list is only a warm-up list and an old reader's input. The authored manifest
reader refused a manifest with no `spawns` ("no declared spawn inventory"); it now reads none as an empty list, as it
already did for `species`, and `faunaTuning` was optional all along. This is the reader half: sharddev can stop writing
the three fields once this engine is the one products are checked against.
