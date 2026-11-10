# Clearing SR12's page-events debt (SPLIT-REPAIR SR12)

The guard shipped with four named debt rows; these commits clear them.

- `pageReturns` and `pageHomes` lose their `actor.died` listeners and
  the table row. RowBodies is always herdless (only the server's
  AnimalManager is not), so pageReturns returned before subscribing
  and pageHomes' homes never held a body for a death to match.
  pageReturns now refuses a page that is not herdless, before any
  program loads, and drops its dead refill step. pageHomes keeps its
  system (its id is a shard's ordering anchor), and the old
  herdless-false parity test, which proved code no page runs, is
  replaced by one that a herdless page holds no body and never
  listens for a death.
- `damage.dealt` (PlayerHurt) stays, with a real producer. A practice
  room cuts the link (`ws:practice-active` sets `player.link = null`),
  so PlayerHurt.fall files a hard landing on the page's own pipeline
  and its `damage.dealt` listener flashes it. The worker client still
  copies the server's hp into the page's health each frame, so the
  fall leaves no number behind. flow:hurt gets a third step: enter
  the room, drop 8 m, see page damage and a flash with no wire hit.
