# Engine pins shard-format v0.4.4 (J308)

> Written by: Claude (opus-sf044), 2026-11-12

J308 renamed the shardfile repo and package to `shard-format`. Engine's `@wildshard/format` moves from shardfile
`0786a04` to `github:project-wildshard/shard-format#v0.4.4` (`17539ea`), which brings `engine-music.ts` (`4696dd0`) for
AUDIO AU18 and AU19. The imports keep the `@wildshard/format` alias, as sharddev does: 661 source files and the
`x-wildshard-checks` strings name it, and J308 leaves wire strings alone. The lock row and the tag name the real package.

The wire pins move to the new repo name at the same commits; pnpm rewrote their rows to `gitHosted` again, so the
`path` resolutions are restored by hand (WR2). `format-lock.mjs` now reads pnpm's codeload-tarball lock shape (it only
knew the `git+ssh` shape, so on the old commit pin it had been reporting "found 0" rows) and checks the tag's
package.json names `@wildshard/shard-format`.

`test/pins/cooked.json` is re-recorded from a ring-cook of template, blender-template and sunscar-dunes on this tree
(revision `f1cf2c1d`). It still named shardfile `v0.4.2` and an old revision; the size moves are drift since that record.
