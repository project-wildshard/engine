# Pay harvest from admitted species rows

ONE-FORMAT OF31e2 retires the engine's table of default drops by creature
kind. The local pack and room claim both read the carcass's declared drops
and apply the pack's item policy. A kind-only body has no harvest claim.

A saved pending claim carries its recorded drops. Earlier saves with no
recorded drops still resolve against a single unambiguous set of admitted
species rows. A consumed claim remains absent on restore.

Pine r7 (`2f9c5dc6`) and Driftwood r6 (`16b498d3`) both passed the native
local and room replay. The replays covered old pending data, exact item
and confirmation indices, and consumed-save restore.
