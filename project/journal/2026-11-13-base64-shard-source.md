# no-base64 reads shard source the way the other rules do

SA24 (opus-sa24b) moved Nine Dragon to a single-shard repo, its shard at
`src/`. SA45's `lint/shard-source.mjs` lets every shard rule read such a
file as `src/shards/<slug>/<local>`, but `no-base64` still keyed its
allowances by the raw path. Nine Dragon's `generators/bake-glyphs.mjs`
(two base64 sites, an allowance in engine's `lint/base64-debt.json`)
read as `src/generators/bake-glyphs.mjs`, so the repo carried its own
debt file through `WILDSHARD_BASE64_FILE`.

The rule now asks `lintFile` first: shard source is keyed by its source
path in either layout, and everything else keeps `base64Path`. A new
case in `test/no-base64.test.ts` lints the same file in both layouts
against one debt key (red first on the single-shard one). Checked on
the real repo: Nine Dragon's `bake-glyphs.mjs` passes against engine's
own debt file with no `WILDSHARD_BASE64_FILE`. Its workaround can go
once its next engine pin carries this.
