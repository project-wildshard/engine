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

## The page shows the clock (SHARD-SOURCE SS-MS1a3)

`installRaceClock` reads the race lines off the wire page each frame:
while `race:<id>` is up it counts from that tick to the latest frame's
tick (`wirePage.tick()`), and when `.runs` rises it shows the finish
time and the best for five seconds in a glass chip at the top centre
(`RaceClockChip`). A page that joins after a finish records the count
first and shows nothing stale.

## The lead's run rides the region save (SS-MS1b's check)

`wildshard check` on Mirror Salt with `world.race` failed its restore
proof: "restored regional suffix diverged in flags.0". A one-player
region save holds the lead's flags and quests but no book parts, so the
lead's running start tick was lost at the checkpoint and the stop gate
finished nothing after the restore. The `quest.declared` step snapshot
now carries the lead's runs under `#races` beside its dialogue nodes,
only when the shard declares races (no save without races changes). The
new test saves mid-run, restores into a fresh host and finishes.

The same check then refused "Missing native quest fact provenance": the
author proof read every filed fact as some quest's `onComplete`. A race
files its fact under its own id, so the proof now takes a race row too
(`test/author-proof-race.test.ts`, failed first). The live filing path
never asked.

## Review fixes before the land

One `claude -p` review found two MUSTs and a SHOULD, each now a test
that failed first. A book carried to another room (`exportOf` and
`importOf`) saved the run's start as the old room's tick, so a younger
room read a negative time and the next import refused the save: the
part now saves the elapsed ticks, as the player doc does for health.
The page clock ran before the wire was bound, saw a run count of 0 and
then showed an old finish on join: it now waits for a tick. And the
start tick rode an f32 owned line, inexact past 2^24 ticks and absent at
tick 0: `raceWire.ts` sends it within a 2^20 window plus one, and the
page reads the elapsed ticks across the wrap.
