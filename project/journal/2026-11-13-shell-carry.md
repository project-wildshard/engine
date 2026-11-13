# The shell cache survives a build update (OFFLINE OF7)

> Written by: Claude (opus-of7), 2026-11-13

QA 11-12 row 36 made `/programs/` and `/shardfiles/` network first, kept in the build's `ws-shell-v3-<build>`. Activate
deletes every older shell, so after an update the first offline launch had none of them. Activate now copies those entries
from the older shells into the new one before the delete (`carryNetworkFirst` in `sw.js`). Chosen over content-naming the
files (no URL, cook or reader change), and over keeping one previous shell (that loses them after two updates with no shard
visit in between). Known and accepted: offline, a shard can read files from two builds, as it already could after a content
deploy inside one shell; the reader refuses a mismatched index.

Proof on two local preview builds, one origin: warm on A, update to B on the title only, then offline. B's shell held 458
carried entries and answered 563/563 of the warm visits' reads; B with the carry removed held 0 and failed all 447. The
offline launch itself still stalls on B's `/assets/spawn/code/<hash>.json`, which nothing reads before a shard visit on B:
that is OF5's set (the route's code list), not this row.
