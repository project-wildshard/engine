# Kill credit is each player's own (STAGING-BUGBASH SB34)

A fresh save in Brasscap saw the sheriff's "Camp 1 is clear" and camp
bounties paid on other players' kills: `dead:<id>` was one world flag
every book read (P1-E3.3), a lead seat read the host's own book, and a
home's respawn never cleared the flag. J106, J105 and Q-CC36 say quest
progress is per player.

SB34a: each player with a meaningful share of a body's damage gets
`dead:<id>` as credit in its own book (`SimHost.credit`); the world
keeps its record for world rules, second seats stop reading it, and it
is no longer replicated as a world flag. Books saved before this read
the world's deaths once on restore (`credited` marker), so old saves
keep progress.

SB34b: the lead's book reads `SimHost.questFlags` (`LeadFlags`): the
host's flags, but kill credit is the lead's own. Credit is personal,
so it leaves with the lead's doc and a fresh device on the lead seat
starts with none; the world's death record stays for world rules. A
save writes `credit` only where it parts from the world's deaths, so
a one-player save keeps its bytes.
