# Side installers: SS3's three open finds (SERVER-PARITY SS3b)

> Written by: Claude (opus-ss3b)

SS3 left three sided kinds with no server installer. Each got a verdict.

**Driftwood's keepsakes (`quest.continuation`): a server half.** The page's keepsakes grant each progression state's
rewards as the sea glass flags count up: 5 glass is Sea glass charm I, +10 max health. A room's server owned book, the
one `installOwnedEffects` reads, never got the charm, so a room player's health stayed at the base. Now
`src/server/game/loot/keepsakeProgression.ts` pays each seated player off their own book's flags on every step their
book moves (a flag, a restore, an imported save), through `progressionState`, the one law the page's keepsakes also
call. It never opens a seat: a dedicated room's parked lead body has no store, and reading one throws. Loot, trophies
and the shop already had server owners (personal loot, creature rewards, the exchange).

**Nalati's adventure saves (`state.adventure`): the server half existed.** `serverChapters.ts` already keeps each
player's feat counts and bond as their own book's flags, and `chapterRecords.ts` keeps the open arena's boss record.
They read the same `quests/persistence.json`; neither registered `saves`. Now both do, and `net-chapters` checks a
second player's wolf and tame feats count as the page's `featOutcome` does.

**Nine Dragon's places (`world.sets`): view.** The page only registers named sets for the sets explorer: no respawn,
no discovery. shard-format `2515bdb` sides `world.sets` and `world.bind-sets` `view`. The KNOWN line stays until
engine takes the next format release.
