# The page output is dist/ (OFF-VERCEL OV3)

dist/ is now the one page output: the Workers asset directory OV1's
`pages/wrangler.jsonc` already names. `prebuilt-output.py` packs dist/
and requires the files a Worker serves (`index.html`, `sw.js`,
`version.json`, `_headers`, `.vite/chunk-modules.json`); the
`.vercel/output` and functions rows, and their link checks, are gone.

A build now refuses what an upload would: over 90,000 files (Workers
allows 100,000) or one file over 25 MiB. Source maps don't count, since
Sentry gets them and the upload strips them. On a v0.1.9-era dist that
is 7,528 files, largest a 11.2 MiB part pack.

The carry-over origin came from `VERCEL_ENV` and defaulted to
`wildshard-singleplayer.vercel.app`, which now 308s to preview. It now
follows `WS_CHANNEL` (production to play, staging to staging) under
`WS_RELEASE=1`, and the release flow sets both. `buildIdentity.mjs`
reads `WS_BUILD_ID` only: builds of exported trees pass
`sourceBuildId(sha)`, the same `<sha7>-<time>` id as before.

`build-vercel-output.mjs` stays for now: the Vercel host still packages
v0.1.10 with it. OV4's Workers host retires it.
