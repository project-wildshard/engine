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

The MacBook owns initial domain attachment and the alias move. After
that, the staging release uses the same phases for its Explore page.
