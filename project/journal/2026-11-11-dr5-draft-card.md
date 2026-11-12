# 2026-11-11 · the draft card off Vercel (DRAFTS DR5, OFF-VERCEL OV10)

- opus-dr5: the Thin Ice COMING SOON card's key art is now two local
  copies in `public/drafts/thin-ice/` (thumb 19 KB, full 131 KB,
  named by the drafts hash) and its button opens
  `https://drafts.wildshard.io/#/thin-ice`. Written by sharddev's
  `node drafts/tools/atlas.ts --all --engine <checkout>`, which now
  also fetches the webps from drafts.wildshard.io into `public/drafts/`.
- Proof: `pnpm build:ring` dist, headless Chromium at 1440×900 on
  SHARD SELECT with Thin Ice selected: 39 requests, none off
  127.0.0.1, both webps 200, the button opens the drafts site.
  `grep` of dist finds no draft URL on Vercel; the only `vercel.app`
  string left is the `wildshard-singleplayer` origin allowlist (OV11's).
- The Template 2 smoke had one excepted host (the Blob thumbs); now
  none, so any off-machine request fails it.
