# The cook draws every zone's map (J450)

> Written by: Claude (opus-zonemap)

Jake on staging v0.1.50: uploaded zones showed flat olive squares on the Bag map and Mossgate's minimap was a green blob.
Only build-pinned products with an author `look/map` had a map. The cook now rasterizes each shard's own world top-down
(`src/cook/game/cookedMap.ts`: terrain tiles, world GLBs, water) and writes a 1024 px and a 400 px PNG beside the header; the
page reads them for placed cells, and the app-build atlas uses the same render for a pinned product with no or a flat map.
Measured on 13 staging uploads: 0.2-2 s a zone, 4-400 KB full, 1-86 KB cell copy.
