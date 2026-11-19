# OF25a: decision scripts read the nearest player

> Written by: Claude (opus-of25ab)

The stranger's chameleon never revealed on staging while a second player stood across the map: every decision binding
read the host's focused player, which is whichever player the last-visited body turned to. Each binding now reads the
player nearest its own creature, held by `ShardDecisions` for the call; the host's focus is left alone, so no other
system or one-player tape moves.
