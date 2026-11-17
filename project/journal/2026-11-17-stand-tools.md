> Written by: Claude
> State: done, 2026-11-17.

SHARD-SOURCE SS-GF1a1a: a tool found on a stand. A tool row an item scene takes
(action 3) that the loadout does not carry starts on its stand for each player,
as a racked melee weapon does (TC-E4): the take puts it in that player's kit lit
and full, a later take refills it without putting it out (a lantern is never a
toggle off at a stand), the owned `.taken` line tells the page, and a save keeps
it. The page keeps it in the kit locked (not drawn, not used) until that line, or
off the wire the stand's own scene, unlocks it. Glowfen's spirit lanterns are the
first user, through the sdk's `world.pickup` (SS-GF1a1b).
