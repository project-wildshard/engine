# Engine fetches no art from shard repos (SF10)

Lane opus-cookktx2, meta standalone shardfiles SF10 (J525). Since the
re-packs (SF5 to SF8), every zone's art rides in its own shardfile, so the
bridge that fetched 144 files from shard repos at a pinned commit goes:
`src/scripts/pin-assets.ts`, `test/pins/assets.json` and its cached copies
under `test/pins/assets/` (2.8 MB), and the `pins.ts install` call that
published them into `public/`.

Readers of the list go with it: the baked-texture byte check for pinned
images, the pins reuse key, the verdict list's `fetched` source, the CI
ledger keys and the land boot-input check, which now keys on
`test/pins/shardfiles.json`. A KTX2 table target must now be in the shard
or tracked in `public/`. `test/no-pinned-art.test.ts` fails if the list,
its cache or a GitHub fetch in the pins install comes back.

Built ahead on `plan/sf-purge`: it lands once SF5 to SF8 are pinned, as
the art the old pins name would otherwise go missing.
