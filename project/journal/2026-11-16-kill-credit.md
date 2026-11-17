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

The sim snapshot is version 4 (`credit`, books' `credited`), read up
from 3 by `migrateV3`; a save's books come back even before a quest
owner made the store, and a player's own fall is nobody's kill.

SB34c: a respawn (`dataRespawn` revive, a home keeper's refill) clears
the world's `dead:<id>`, so world rules see the body alive; players'
credit stays in their books, so no quest walks back.

Review MUST: a boss's `deadFlag` and a shard's death-effect flags are
credit-shaped world writes no body id names. One raised while a death
is told goes to its killers; one no death claims goes to everyone
present at the next tick.

## SB3: the journey gates production go-live (2026-11-17)

- J386 asked that every release run the tapped journey before prod.
  `page-release.mjs production go-live` now reads the journey reports
  `verify-staging.sh` leaves (`tmp/verify-staging/<browser>/journey-<card>/report.json`)
  and refuses until Driftwood and Pine Hollow passed cold and warm in
  Chromium and WebKit on this exact build (`journeyGaps`, flow.mjs).
- `journey-proof.mjs` records the build staging served before and
  after the run (none if it moved) and gains `--prime <dir>`;
  `verify-staging.sh` defaults to both cards. Tests red first: the old
  gate let go-live through with no journey at all.
