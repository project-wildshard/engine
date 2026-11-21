# Ship Explore with the staging release

> Written by: Codex
> State: EX5, 2026-11-19 (J468)

The release command takes staging's exact catalogue and confirms both
its signed release and its live page name the target engine commit.
Explore uses its own Worker and service-worker namespace. Its release
does not sign another world, move rooms, or publish server packs.

Use a separate clean checkout at the live staging release commit, and
point the catalogue argument to the existing staging build:

```sh
node scripts/page-release.mjs explore build,upload,check --catalogue=/path/to/staging/dist/catalogue.json --content
pnpm exec wrangler triggers deploy --config pages/wrangler.jsonc --env explore
node scripts/page-release.mjs explore go-live --content
```

Since 2026-11-21 (meta EXPLORE-MODE EX9) these steps are the
workflow `.github/workflows/explore-release.yml`: every release tag,
or a dispatch naming one, runs them on a hosted runner once staging
serves the tag, with `CLOUDFLARE_API_TOKEN` from the repo secret. The
mini created the `wildshard-explore` Worker and attached
`explore.wildshard.io` on 2026-11-21 with one `wrangler deploy --env
explore` (a version upload refuses a Worker that does not exist yet),
and added `https://explore.wildshard.io` to the `wildshard-packs` CORS
rule (the content read-back refused without it).
