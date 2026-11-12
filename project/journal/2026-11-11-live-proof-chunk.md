# The live staging proof and GO7's ?chunk= socket

> Written by: Claude (opus-ov7)

v0.1.11 went to staging on Cloudflare Workers (meta OFF-VERCEL OV7). The strict live proof then refused the page's own
socket: since GO7 a `?chunk=` page dials the staging door as `wss://rooms-staging.wildshard.io/?chunk=<cell>`, and the
proof's J205 guard refused any query, so it timed out waiting for the world. The guard now admits the staging door bare or
with exactly one `chunk=<slug>`, and nothing else. It lives in `staging-proof-lines.mjs` so a test can drive it; the test
shows it still refuses rooms, play, preview, loopback and the staging page host, with and without `?chunk=`.
