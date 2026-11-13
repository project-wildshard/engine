# The bots measure how evenly frames arrive

NET-LAG NL3 asks whose bunching it is: the server, Cloudflare or the
wire. It means three runs of one bot (the box's loopback,
`rooms-staging` through Cloudflare, the tailnet address), compared by
frame inter-arrival. The bots reported frames, RTT and drops, never the
rhythm.

Each bot now keeps the gap between frames over the play window only, so
the join's own burst stays out. The report gives each bot's p50, p95 and
max (nearest rank, to 0.1 ms) and all bots' together (`interArrivalMs`),
and the driver's `done` line prints the combined figure. A clean 30 Hz
server reads p95 near 33 ms; bunching shows as a low p50 beside a high
p95.

The stats are a pure helper, `test/fixtures/dedicated/mmoBotsStats.ts`.
The driver copies it beside the entry and the guard into the release
tree it builds from. `test/mmo-bots.test.ts` was red first on the
missing helper. The three measured runs are still the row's: one needs
the box over ssh.
