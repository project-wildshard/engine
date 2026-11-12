# OV9: Vercel names out of engine (opus-ov9, 2026-11-12)

- Origins: `identity.ts` error reports, `doorTrust.ts` DEFAULT_ALLOWED_ORIGINS, `setup.sh`'s server unit, Caddy's
  `@foreign` Origin match and `harden.sh` VH10 now name only play, staging and preview.wildshard.io. The old
  `wildshard-singleplayer.vercel.app` page host is gone from all five. Red first: four new tests failed before the change.
  This waits on its branch until OV8 has moved play.wildshard.io to Cloudflare, or a client still served by Vercel would be
  refused by the door.
- page-release: the Vercel host module, its API route helper (`e7-page-routes*.mjs`) and the per-channel host defaults
  are gone; `--host=workers` is the only value. Red first: a CLI usage test for any other `--host`.
- Commit order: the page-release commit went in first; the origins commit's commit lane timed out once on a loaded machine.
