# PZ10: the service worker keeps CDN content (opus-pz10)

- `sw.js` handles GETs to the content base's origin (baked from the document's stamped `contentBase`): cache-first
  from `ws-content-v1` by exact URL; a miss is a CORS fetch with no credentials, kept only as a CORS 200 (never opaque,
  never a 206). No activate touches the cache. `/releases/*` and `/clear-cache.json` there go to the network.
- A page-origin part (`/assets/spawn/**/<hash16>.pack.br`) is content too: it lived in the per-build shell cache and
  died at every update.
- The bake moves every content path of the precache lists (both books, title art) to their CDN URLs, precached at
  control, so adoption waits for them. With no content base the lists are today's; a test pins it.
- The bundler folds a literal `'__X__'` base into `new URL(...)` at bundle time, so base and files bake as one JSON.
- Clear downloads also fetches `packs.wildshard.io/clear-cache.json` (zone rule `packs_cdn_clear_cache`: `Clear-Site-Data:
  "cache"`, `no-store`; the R2 object holds `{"clear":"cache"}`).
- Review (one `codex exec`, five MUST, all fixed): Clear downloads' CDN read was `credentials: 'omit'`, and Chromium
  ignores `Clear-Site-Data` then (the journey showed it: 49 of 167 CDN files still came from the HTTP cache; with a
  credentialed no-cors read, 0). A no-cors read is rebuilt with `new Request(request, …)` so headers and redirect stay;
  a cors, same-origin or only-if-cached read goes as it came. A content base on the page's own origin owns its folder
  only. A bake of a split output sees the hashed `assets/` the split moved.
- `scripts/content-sw-proof.mjs` (split build of this branch, Driftwood): books precached at CDN URLs; after a no-shard
  rebuild adopted, 0 CDN reads and 0 of 563 `ws-content-v1` entries lost; Clear downloads leaves `caches.keys()` empty;
  the cold reload reads all 167 CDN files from the network.
