# 2026-11-17 the race clock (opus-ss10e)

## The sim keeps each player's run (SHARD-SOURCE SS-MS1a2)

Mirror Salt's arch line wants a timed run; the format had only
countdowns. shard-format 0.18.0 adds `quests.races` (`{ id, start, stop,
fact, cap }`), so `DeclaredQuests` now times each player from the start
flag rising to the stop flag rising. The finish files the fact (the
ledger has no value slot, so the time stays in the player's quest book:
last, best and a finish count, saved as a book part) and lowers both
flags, so a region trigger can start the run again; past the cap the run
lapses and files nothing. The race flags are claimed, so each player
runs their own. The owned lines `race:<id>` (running start tick),
`.last`, `.best` (ms) and `.runs` carry it to the page.

My first `finish` name shadowed the dialogue `finish(id, player)`: the
test caught it ("Unknown quest player [object Object]"); the race
methods are `finishRace` and `lapseRaces`.
