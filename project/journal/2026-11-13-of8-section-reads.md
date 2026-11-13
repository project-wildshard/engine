# OF8: neighbour section reads, versioned and read once

> Written by: Claude (lane opus-of8), 2026-11-13

The open-plots offline audit saw a warm grid load ask for 24 neighbour section URLs 77 times. Showcase Template left the
grid in J305, so the proof shard is Signal Dunes (6 neighbours read): on the slow link, 64 requests for 20 URLs before,
20 for 20 after, and a second warm visit takes all 20 from Cache Storage (0 worker network fetches; 24 before). Two causes in
`src/client/game/grid/products.ts`:

- Only the index read carried `?v=`. A neighbour's `sections/world/*.json` went out bare, so the service worker's
  `immutable()` never kept it and every visit went to the network (OF0 later made `/shardfiles/**` network first).
- The far ring's byte charge, the far proxy and the near proxy each read the same neighbour's tiles (and the proxies its
  collision, props and look) at the same moment, with nothing sharing the read.

Now a first-party section URL carries `?v=<first 8 hex of the hash the index declares>`, the same name the cook gives
it in a spawn manifest (`shardCook.ts` productFile), so the worker keeps it in `ws-assets-v1` and a grid spawn
download's copy answers it. One in-flight read per URL is shared, and a first-party section's verified bytes stay in
memory afterwards (least recently used out past 2 MB), because the proxies read world/tiles a few hundred ms after the
far charge's read has settled. Each caller parses its own copy.
Blobs are untouched (already content-named), and third-party products keep bare URLs.

The unit test in `test/grid-index-edges.test.ts` holds two concurrent reads open on a gate and counts fetches; it
fails on the code before this change (2 fetches, and no `?v=`).
