# New placements must be ready for the staged build

The v33 native gate entered Driftwood and moved both real players, but
failed its strict audit on a missing index for async-sp22-11162320.
That probe arrived after our three-head warmup and was cooked only by
v32. Its owner removed it; the isolated Chromium retry passed unchanged.

MU13 now checks every currently signed extra placement before staging
check and again before aliasing. Missing indices use the normal full
CookWorker at the exact checkout, with credentials in its parent only.
The public build/hash/slug, full-check pass and CORS must match. New
heads appearing during the work refuse the phase for a retry. Built-in
cells retain their existing book/part gate; no head or index is invented.

Tests went red first because check and go-live previously accepted a
new unready placement. Added coverage for publishing, already-ready
heads, failed publication and a changed raw head during the cook.
This does not freeze uploads after the alias or change API placement.
