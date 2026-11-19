# Stale-preparation worker file budget

> Written by: Codex
>
> **State:** J295 fix for the 2026-11-19 amber on engine `ea35a15d`.

Hosted run 44601413215 charged 63,650 ms against 60,000 ms for one passing worker case. The fixture moved from
Template to Brasscap in `9cefedb2`. The pinned archives grew from 11,968,000 to 21,988,864 bytes, and each of the
three fresh worker children cooks the product again. `c5702969` updated slug assertions after the switch,
`0d017856` changed the aggregate watchdog, and `436b54b4` reused the compiled job entry across children.

Build a small product from the format's real empty shardfile and section writer. The worker still validates it,
runs the ordinary bounded child, publishes both indexes with equal nonempty object keys, and reports a stale
preparation for both the moved and unspecified fingerprints. The in-process stale-preparation and cooked-map
suites still load Brasscap for their real asset, pack and map checks. The worker case uses a single 60,000 ms
timeout and the same 50 s child limit. The CI file budget stays at 60,000 ms.

The CI reporter on the mini charged 25,035 ms with the old fixture and 7,659 ms with the new one, measured in
isolated worker-suite runs with the same engine code and reporter.
