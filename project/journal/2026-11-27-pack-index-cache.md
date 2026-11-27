# Check an index after publishing over a prior CDN miss

QA45. The new Nalati and Nine Dragon indices read back from R2 while
Cloudflare kept serving cached 404s at their ordinary URLs. Cache rule
2ec8bec2 stops caching 404s under packs.wildshard.io/index/.

The opt-in contract requests the same plain URL before and after an
immutable write. It checks the new bytes, staging CORS and a 200 cache
hit, then removes its own object.
