# 2026-11-27 An unprepared fence shard's phone gets its whole level (SF5d)

With the phone keys fixed, Pine Hollow 0.0.18's cooked phone entry still failed: it asked
`/assets/pine-hollow/baked/code-parts-bd582243b159.bin` from the page. Pine declares a `fence` pack set
(`src/packs-set.json`) but is unprepared, so its cook data is version 1, which since FP23 records no fence. `fenceHints`
returned no mounts, yet `fenceSet` still held, so the phone's whole set carried only the far view and the textures: 654
files against desktop's 1231, with no navmesh, near.glb or code-parts. A fence set now needs a prepared cook (version 2 and
up); an unprepared one lists its whole level for the phone as for the desktop. test/unprepared-fence-whole is red on the
old rule. Cook 1.15.1.
