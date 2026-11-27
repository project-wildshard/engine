# Cook held rig maps as data, right side up

Nine Dragon's arms read their packed maps and normal maps unflipped, as
numeric data. The cook picked a role and a flip from each URL, so it
encoded `hand-r-maps.webp` as an upside-down colour texture (about 8 dB
against the hand-made set on the SF7f board). The cook now reads each
held document's `maps` row and encodes those files linear or normal, in
the file's own orientation. A test decodes the cooked files against
their source, and another cooks them through `shardHalf`.
