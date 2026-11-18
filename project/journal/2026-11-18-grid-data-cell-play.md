# 2026-11-18: a grid data cell's card, audio and input (opus-ss)

SHARD-SOURCE SS-GP4a to SS-GP4c. Checked first: the Template that `wildshard new` writes (sdk 0.4.8, built on the mini for
SA17) declares a quest-triggered completion card, sword and swap cues with a forest bed, and a lantern input context; every
`new` shard placed on the grid is a data cell, so all three were missing there. Each is now one more per-stay install in
`liveSession.enterDataPlay` (`dataCellCompletion.ts`, `dataCellAudio.ts`, `dataCellPlumbing.ts`), each with a grid test.
Loot coins and the compendium (rows 12, 13) are the rest of SS-GP4.

SS-GP4e: gear loot. A data cell whose loot row carries gear (the Template's `purse.coins`) installs its purse, coin burst,
chip and Bag loot row per stay (`dataCellLoot.ts`); `stayContext` takes the copy's own folder so the loot presentation reads
the copy's `economy/loot`, not the home's.

SS-GP4d: compendium and journal. A data cell's compendium registers from its own folder per stay and its journal (N key,
FINDS row, Journal pill, tracker on a cell-named system) installs and leaves with the stay. Found doing it: the plain
`installCompendium` path never removed its Bag FINDS row (only the menu's scope did), so a second entry would throw
"Duplicate Bag finds"; the row now goes with the journal's scope. That closes SS-GP4.
