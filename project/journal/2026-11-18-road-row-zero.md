# Cell rows keep their local positions

`1847f5c5` used the wide road fields for server distance checks. The
16-bit fields span -2,048 to 2,048 metres, so a cell's zero sentinel
decodes to about 0.031 m. The old reader put every local player and
creature at that spot. It broke distance tiers, relevance, proximity
chat and riding prediction in CI `44456318426`.

The server and both client readers now recognize the decoded zero
using the compiled column. Road rows still use their wide coordinates.
The Nalati payload digests reflect the restored distance tiers with
the same wire 1.3 layout. The real road and home-edge tests prove
that out-of-cell coordinates and read-only creatures still work.
