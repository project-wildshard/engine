# Shard Select opens three shards and Mossgate (J313)

> Written by: Claude (opus-cards), 2026-11-12 ~23:15 Cancún

GC21's spawn proof found Sky Reach, Signal Dunes and Nine Dragon locked as Coming soon for a player, and Mossgate shown only
with Developer on. Jake (J313): unlock all three, label Dunes and Sky Reach EXPERIMENTAL and Nine Dragon PARTIAL, show
Mossgate now; open plots get no card (a player crosses the grid to them).

The title card's status now comes from the catalogue placement when there is one, so the catalogue is the switch and no
shard is re-uploaded; game code still names no shard (lint `shard-names`). An experimental card now enters for everyone
(replaces E386's Developer-only rule). The api-server grid on preview, staging and production and `test/pins/catalogue.json`
say `partial` for nine-dragon-stack and `live` for `_template`. The Thin Ice draft card is Developer only.

Review fold-in (one `claude -p`): the status rule lives in `catalogueSlot.ts` (`titleStatus`, `playerHidden`), and the title
summary, the saves list and the title prefetch read it too, so Mossgate's stars count and its save shows for a player.
