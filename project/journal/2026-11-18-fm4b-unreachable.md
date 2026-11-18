# Can't reach the world (FM4b modes 5 to 8)

> Written by: Claude
>
> **State:** built 2026-11-18, opus-fm, meta MMO-FAILURE-MODES-PLAN FM4b.

A page whose first socket never reached the world showed the
Reconnecting banner, then Still reconnecting, then Couldn't reconnect:
words for a link that was once up. The buddy lane parked mode 5 on a
design call in 11-13: the rooms `/health` is private (D7), so a page
cannot tell a down world from a mid-play drop. The recommended way is
taken here: the card is only for a link that never heard a frame.

Redial's progress now says `neverHeard` until the first frame. After
10 s down, online, with the cause still a plain close or a silent link
(not a restart, not an old server's cut), the link screens show the
`unreachable` card instead of the banner. It says what the page
measured: its dials, the next one, and whether the game's own site
answers (a same-origin `version.json` read, any HTTP status counts).
A refused upgrade, a name with no DNS answer, a refused certificate and
a reset all reach the page as one 1006 close, so the card names none of
them; the date-and-time line is help, not a diagnosis.

The address itself may be what is wrong, so while the card shows the
page reads its signed release file again (on open, every 30 s and on
Try now). A new address takes the next dial; another build reloads as
the fresh read after a kept copy already did. A link that was ever
live keeps FM4's banners and the 120 s Couldn't reconnect card.
