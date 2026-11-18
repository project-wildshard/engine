# 2026-11-18: a grid data cell's card, audio and input (opus-ss)

SHARD-SOURCE SS-GP4a to SS-GP4c. Checked first: the Template that `wildshard new` writes (sdk 0.4.8, built on the mini for
SA17) declares a quest-triggered completion card, sword and swap cues with a forest bed, and a lantern input context; every
`new` shard placed on the grid is a data cell, so all three were missing there. Each is now one more per-stay install in
`liveSession.enterDataPlay` (`dataCellCompletion.ts`, `dataCellAudio.ts`, `dataCellPlumbing.ts`), each with a grid test.
Loot coins and the compendium (rows 12, 13) are the rest of SS-GP4.
