# 2026-11-27 A fence shard's whole set carries its own sfx (SF11)

With the SF10 to SF12 batch applied, pins stop copying a zone's mounts under `public/`, so the build's audio tables
list engine sets only and the boot adopts a zone's own manifests from its mounts (`withShardMounts`, entry plus phone
whole). Driftwood is a fence shard: its phone whole set carried its own far view and its own score (`ownScore`), but
not its own sfx folder. Its `sfx.json` had reached the tables only through the `public/` copy, so the boot drew 75
recordings, none of its 16 own variants. `ownSfxDirs` finds each `/assets/<slug>/sfx/<set>/` folder beside its manifest
and the phone whole set carries it, as it carries the score. The golden cook is unchanged, so cook 1.17.0 stays with a
same-output declaration. Guard: `test/cook-own-sfx.test.ts`.
