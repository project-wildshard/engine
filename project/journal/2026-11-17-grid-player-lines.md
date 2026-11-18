> Written by: Claude
> State: done, 2026-11-17.

SHARD-SOURCE SS-GF1a2 (opus-ss10l): on staging Glowfen's socket prompt ran ("Set a spirit lantern"
used) but the socket glow never showed: a grid cell's panels read only shared rows, and a player
field a script writes is that player's owned line (`script.player-fields`, 6dee015f). A grid cell now
reads the owned line for the same player fields the one-shard page does (`ownedLineFields`, shared by
both), so a socket lights for the player who set it on the grid too.
