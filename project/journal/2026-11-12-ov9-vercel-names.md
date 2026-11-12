# OV9: Vercel names out of engine (opus-ov9, 2026-11-12)

- Origins: `identity.ts` error reports, `doorTrust.ts` DEFAULT_ALLOWED_ORIGINS, `setup.sh`'s server unit, Caddy's
  `@foreign` Origin match and `harden.sh` VH10 now name only play, staging and preview.wildshard.io. The old
  `wildshard-singleplayer.vercel.app` page host is gone from all five. Red first: four new tests failed before the change.
  This waits on its branch until OV8 has moved play.wildshard.io to Cloudflare, or a client still served by Vercel would be
  refused by the door.
- page-release: the Vercel host module, its API route helper (`e7-page-routes*.mjs`) and the per-channel host defaults
  are gone; `--host=workers` is the only value. Red first: a CLI usage test for any other `--host`.
- Commit order: the page-release commit went in first; the origins commit's commit lane timed out once on a loaded machine.
- Product sha: `readBuiltShardfile` takes the CI product fast path only when `WS_TEST_PRODUCTS_SHA` equals `GITHUB_SHA` (the checkout ci-checks already checks), not the old host's commit env; hover-contract and nightly stop setting it (buildIdentity reads WS_BUILD_ID only since OV3). Red first: two vitest cases and the Python prepared-build test.
- Dev tools default to https://play.wildshard.io instead of the old vercel.app address; comments that described the old host's behaviour now describe the page host or Cloudflare.
- vercel.json and .vercelignore deleted. The local preview server replays _headers (dist/_headers, else public/_headers) instead; page-headers.test.ts keeps its every-rule check against the 27 old rules frozen in test/fixtures/page-header-rules.json. release-url.sh and worker-proof-page.mjs (old-host-only tools) deleted; parity/serve.mjs carries the export ignore list itself. Red first: two preview-server tests failed on missing cache-control before the port.
- Codex review (one shot): SHOULD fixed, the preview server now fills a value's `:splat`/`:name` from the matched path as Workers do. MUST declined with reason: build-vercel-output.mjs still reads the deleted vercel.json, but only deploy.yml reaches it and deploy.yml runs only on the `nightly` branch, which does not exist; OV5 deletes both.
