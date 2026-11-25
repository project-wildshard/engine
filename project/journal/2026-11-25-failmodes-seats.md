# The nightly fail-mode run failed its own harness

> Written by: Claude (opus-failmodes), meta QA 11-25 row 65

The nightly failed eight modes every day since 11-19 and never got past case 25. None of it was the game.

- The run takes `--seats=2`, so mode 25 can show the door's real line. Every case then closed its browser context bare, and the
  world held that seat for five minutes. By the third case two held seats filled the door, and each later play case was refused
  `full`: a socket fault matched nothing, a heal never seated, a half-open link read as a drop. The server log said it plainly:
  `held 2`, `refusals {full: 1}`. Cases now leave as a player does (Leave the world, whose clean quit frees the seat at once).
- `browser-lane.sh` kills its command after 60 minutes unless told otherwise. The nightly never told it, so it died at exactly
  60 minutes, which read as running out of memory. It now gets 190 of the job's 200.
- Mode 10b expected ENTER on the title to hold during a deploy's last seconds. Since QA 11-23-b row 5 (Jake wanted ENTER ZONE
  instant) the title asks the world first only in a tab that heard it restart, so the case now plays that tab.
- A case that ended mid-redial (its finally healed a moment before) quit on a dead link, so its old seat stayed held and 16b
  and 17 were refused `full` again. Leaving now waits up to 20 s for the redial to seat first.
- The fixture's second build is a copy of the first under a new name, but a page imports its online bundle from
  `/b/{its own build}/`, which only the first had. A page booted on the second build never went online, so 10b's held tap
  never joined. The second build now carries the folder under its own name.
