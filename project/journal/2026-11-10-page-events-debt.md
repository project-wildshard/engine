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
