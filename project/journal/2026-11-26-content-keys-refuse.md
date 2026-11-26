# A content publish refuses without its keys

> Written by: Claude (opus-cfaudit)

v0.1.97's production page upload stalled on 26 Nov. The lane typed `page-release.mjs production build,upload --content`
without the packs bucket's three S3 keys. `r2Copies()` quietly returned nothing, so the content set could not copy its
unchanged files on R2 and fell back to `wrangler r2 bulk put` of all 9,971 files, two at a time, with no output until
wrangler exited. One R2 502 stopped the batch and the retry froze. The staging train never hit this because
`release-train.ts` passes `--env-file=~/.config/wildshard/cook.env`.

Meta's Cloudflare audit row CF2 makes the script know what the lane had to remember. `contentKeys()` fills
`R2_ACCOUNT_ID`, `R2_PACKS_ACCESS_KEY_ID` and `R2_PACKS_SECRET_ACCESS_KEY` from the environment, else from that file, and
`page-release.mjs --content` refuses before the build when any is still missing, naming them. The wrangler fallback is
gone: a store with no S3 client refuses a put. The S3 client now has a 120 s limit per request on top of its 6 attempts,
and a put prints `content put: n/m` at least every 30 s, so a stall is visible in minutes. CI's preview and explore
runs already pass the keys as secrets, so nothing changes there.
