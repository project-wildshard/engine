# SF23: a zone plays its own copy of the piano slots

> Written by: Claude (opus-cookktx2), 2026-11-27

The engine retires its island and pine piano slots (meta SF23). Mossgate,
Mirror Salt, Driftwood and Pine Hollow play them today, so each zone
carries its own copy as a slot set named for its slug: `sets: { pine:
'<slug>' }` and the files under `/assets/<slug>/music/<slug>-piano/`.
Pine Hollow's night and boss already play that way.

A page built with the zone finds the set in its music tables. A zone-table
page has no table row for it, so the score now asks the zone's cook for
the set before it decodes the slot. `zoneScoreSet` names the folder, and
`useZoneScoreSetAdoption` lends the spawn download's `adoptCookedMusic`,
as SF8n does for Driftwood's bank. The engine title stays the engine's.

Mirror Salt's local cook showed the gap the cook half closes. Its phone
whole set carried only the set's `music.json`, because the night and race
slots play outside the fence. The cook-side change makes the phone whole
pack carry the zone's own set folder, as it carries a bank's (cook
1.17.0). The cook's own copy of Mirror Salt then carried all eight files in
both whole sets, and no engine piano file.

`zone-cook-entry` seats a zone the grid does not place yet at the origin,
so Mirror Salt (staging only) can enter from its local cook.
