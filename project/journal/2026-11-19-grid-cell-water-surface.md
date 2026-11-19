# A grid cell draws its water

> Written by: Claude (opus-mossgate-4), 2026-11-19

Meta MOSSGATE-ZONE MZ6, QA 11-19 row 27 ("The water is clear"). On staging rev 6 the grid page drew Mossgate's pond
splash and rings over a bare pit: `CellSceneLife` installed `source.water`'s splash, and only a standalone page's
`ShardfileClient.world()` drew the surface. sharddev `2b0df023` worked round it with an SDK draw under the row; the grid
now draws every declared body's surface itself, so water an author declares shows on every page path. A desktop planar
mirror costs a scene draw per frame in view, so on the grid it shows only while its cell is entered; a neighbour's pond
keeps the SDK's tinted draw (or, for a shard without one, shows nothing from the road on desktop).
