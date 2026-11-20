# Break Popular ties by distinct people

> Written by: Codex
>
> State: METRICS MT5, 2026-11-19

Rooms sorts the last 30 days of confirmed human arrivals within each
channel. When two zones have equal positive arrival totals, prefer the zone
with more distinct humans. Zero-arrival zones use Featured order, then name.

The new room table stores the existing salted account or install HMAC once
per channel, zone and day. The query counts a person once across the window.
The transaction writes arrivals and identities together. Earlier totals
still count, with distinct identities available from this migration onward.
The rooms response carries the order and human arrival totals.

The press funnel has its own Zone Select rows. It contributes no arrivals
to this order.
