# Zone Select presses on the MMO door

> Written by: Codex

J467 defines Popular by confirmed seats and walk-ins. J470 and J471 put
the list and per-player work on the MMO door. `POST /zone-select/enter`
records a press separately by channel, day, shard and actor. The existing
retry-safe batch transaction persists presses in `zone_select_presses`
alongside arrival data. It needs no device key, session or player ID.

The endpoint accepts a small JSON body from a configured game origin.
Clients can use text/plain and the existing actor query or user agent to
avoid a preflight. The trusted proxy controls the IP for the 30 per minute
limit. Unknown or closed zones, wrong channels and preview add no count.

ZS14 deploys the route. The rooms proxy needs exact matches for both
Zone Select paths and OPTIONS on the press path. The door does its own
origin checks. Its GET response is cacheable for 30 seconds, while POST
and OPTIONS on the press path use no-store.
