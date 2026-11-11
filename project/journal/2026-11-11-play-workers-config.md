# The game's pages get three Cloudflare Workers

Vercel's $1 spend cap paused every project on 11-11, and preview still
answers 503. Jake (J272): host nothing of the game on Vercel. This is
meta OFF-VERCEL-PLAN row OV1, the first step: config only, nothing
deployed.

`pages/wrangler.jsonc` makes three Workers from one file, reusing the
pattern www just shipped (`www.wildshard.io` `623f14c`):
`wildshard-play` at the top level, `wildshard-play-staging` and
`wildshard-play-preview` as envs. Production is always named with
`--env ''`, or wrangler warns that it guessed. Assets come from
`../dist`; a missing file 404s rather than serving the page, because
`previousDeploy.mjs` reads `text/html` as "this chunk is gone".

`pages/worker.ts` runs only for `/` and `/index.html`, so every other
request is a free asset hit. It ports vercel.json's two `?doctor`
redirects and the page's `no-store`. It serves `/index.html` as `/`:
Vercel answered it 200, while the assets' default HTML handling would
307 it.

`test/page-workers.test.ts` reads the config through wrangler's own
reader, checks no name clashes with packs, voice-ice, api or www, runs
`wrangler deploy --dry-run` for all three envs offline and drives the
Worker. OV2 brings `_headers`, OV4 the release script, OV6 the first
real upload.
