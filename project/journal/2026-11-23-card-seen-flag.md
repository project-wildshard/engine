# The completion card's seen flag reaches the server

> Written by: Claude (mini-zonefix), 2026-11-23

A completion card sets its `seenFlag` on the page, which sends it as `story:<flag>`. Only `serverChapters.ts` answered
`story`, and only for flags a nearby talk sets, so the server dropped it; the page's write lapsed after
`FLAG_ANSWER_TICKS` and the card reopened on every entry (meta QA 2026-11-22, found by mini-zoneclose closing MZ37).

`src/server/game/quest/completionSeen.ts` now takes a card's seen flag (declared `ui/completion`, else the default card)
from a player who already holds the card's done flag, as that player's own flag, so it rides their save. Every other
`story` flag still goes to the chapters. The default card's rows moved to `src/shared/game/quest/defaultCard.ts` so the
server derives the same flag the page writes.
