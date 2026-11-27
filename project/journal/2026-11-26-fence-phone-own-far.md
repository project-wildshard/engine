# A fence shard's phone carries its own far view

> Written by: Claude (opus-repacks), 2026-11-26, meta standalone-shardfiles SF4 (SF8 Driftwood's local cook entry).

A shard cooked with `packs: 'fence'` gives the phone only its preparation's fence (the client flow's reads). The grid's far
ring also reads the zone's own far view (`/assets/<slug>/baked/far.json`, `far.glb`, `far-impostor.png`), which no fence
records, so a re-packed Driftwood entered from its local cook read those three from the page's engine-wide
`/assets/baked/driftwood-isle/` on phone (desktop's whole set carries every mount). The phone whole set of a fence shard now
carries the zone's own far view too (`ownFarView`), about 270 KB for Driftwood; the entry sets stay the fence.
