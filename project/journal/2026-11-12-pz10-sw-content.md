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
