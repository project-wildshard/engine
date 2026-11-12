# 2026-11-11 page release flow committed

> Written by: Claude (opus-relflow)

Jake, about 19:15 Cancún: "Add staging & production release flow to the engine repo." The page release for v0.1.5 to
v0.1.9 ran from scratch scripts copied per release in singleplayer `tmp/codex-release/` (`v019-*-refresh`,
`-promote`, `-production-static`, `publish-e7-server-packs`). `scripts/page-release.mjs <channel> <phase>` now does
the same steps with the same gates: build unaliased, packs first with CORS read back, deployed bytes compared, wait
for the signed serial and matching `/health`, alias last. Pages bake `https://packs.wildshard.io/releases/<channel>.json`
(PACKS-CDN PC3), so v0.1.10 ships with it. The Vercel host is one file so OFF-VERCEL OV4 can add Workers beside it.

Found on the way: a Vercel deployment file's `uid` is the SHA-1 of its bytes (checked on v0.1.9 staging), so the
deployed-bytes check reads only the file index, not base64 bodies.

Codex review fixes: the Vercel CLI gets its token in `VERCEL_TOKEN` and child output is printed redacted; every
pack read carries a fresh query because `packs.wildshard.io` caches 404s (MISS then HIT, checked 11-11); go-live logs
`ALIAS MOVED` the moment it moves the alias.

**OV4, the Workers host (opus-ov4, 20:10 Cancún).** `hosts/workers.mjs` plugs into the same seam: `wrangler versions
upload --tag <sha> --message v<version>` (the version id and preview URL come from `WRANGLER_OUTPUT_FILE_PATH`'s
`version-upload` entry, not scraped text), the check reads `versions view <id> --json` for the tag and SHA-256s each
document off the version URL, and go-live is `versions deploy <id>@100% --yes`. Production is `--env ''`. `--host`
picks the host; vercel stays the default for staging and production until OV7/OV8. Preview joins the flow as the solo
channel (no release file, packs or gate). `importmap.json` is not a file (the map is inline in `index.html`), so the
checked documents add only `sw.js` and `deploy-chunks.json`. Nothing deployed: OV6 does the first upload.
