# A missing asset is never cached (opus-au4, AUDIO AU4, J299)

Prod `play.wildshard.io` answered a missing `/assets/*.js`, `/assets/sfx/.../*.m4a`, `/b/*` or spawn part with
`404` and `Cache-Control: public, max-age=31536000, immutable`: the static assets apply the path's `_headers` rule to
a miss too. One miss during a deploy could then sit on a phone, or at the edge, for a year.

With `not_found_handling: "none"` a miss already reaches `pages/worker.ts` (the fallthrough). The Worker now sends any
answer but a 2xx or a 304 with `no-store` (`uncachedMiss`), in the fallthrough and in `part()`. Hits keep their
`_headers` cache; a 304 keeps its headers so a cached part isn't downgraded.

The service worker (`src/client/engine/pwa/sw.js`) never stores a non-2xx from the network: every `cache.put` of a
fetched response is behind `status === 200` or `response.ok`. Its two copy paths (old caches into the new one) copy
what an older worker stored, not a fetch.

Test: `test/page-headers.test.ts` (wrangler dev) checks GET and HEAD of eight misses say `404, no-store`, and three
hits keep `immutable`. It was red before the fix with prod's exact header. Ships with the next release; no deploy here.
