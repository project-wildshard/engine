# 2026-11-28 Cooked objects get their headers from their key (CK1)

Meta CACHE-FRIENDLY-COOK-BUCKET CK1, built ahead of the plan's review as a bug fix. `publishCooked` asked
`objectHeaders` about the page path (`assets/pine-hollow/baked/tex/clouds.jpg`), not the object key
(`shards/pine-hollow/0.0.18/common/<sha256>.jpg`). `CONTENT_NAMED` only matches a hex name, so 144 of Pine
Hollow's content-named `common/` objects (65.3 MB of JPG, WebP and PNG) went up as `max-age=300` and a phone
re-checked or re-downloaded them on every visit. Parts were fine: `.pack.br` is matched by its suffix.

Now the key is passed. The index keeps `max-age=300`: the versioned carry may replace an index in place when a
newer validator judges the same bytes, so its address is not immutable. `putImmutable` skips an existing key, so
live objects keep their old header until they are re-stamped by hand (meta plan CK1). publishCooked is in the
cook closure, so the cook record takes a same-output declaration: the bytes are unchanged, only R2 metadata.
