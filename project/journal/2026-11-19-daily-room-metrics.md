# Daily room metrics

METRICS MT9 adds a dated aggregate for each public room channel. The room
database counts distinct people across its session and arrival records and
joins confirmed arrivals with button presses by day and zone. The public
route sends those counts and game totals. Caddy gives that route a GET-only
exception, and the Prometheus listener stays on loopback.

The dedicated-room fixture uses the real Postgres migrations and HTTP
handler. It verifies account deduplication, agent lanes, channel isolation
and separate arrival and press counts.
