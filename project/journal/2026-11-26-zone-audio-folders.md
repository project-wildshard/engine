# A zone's audio under its own name

> Written by: Claude (opus-repacks)

Standalone shardfiles SF4 says a zone mounts its art at `/assets/<slug>/...`, never at an engine-wide path. The re-packs
(SF5 to SF9) cannot move one file until the engine can find it there, and audio was the first wall: the boot tables key
every music and sfx manifest by its folder name under `public/assets/music/` and `public/assets/sfx/`, and five readers
spelled those folders out.

The new `src/shared/engine/boot/zoneAssets.ts` holds the rule: `/assets/<slug>/<kind>/<name>/...`, the slug dropped when the
name is the slug. Audio keeps its manifest key (`/assets/<slug>/music/<key>/music.json`), and the table row of such a
manifest carries its folder as `$dir`, written by gen.ts at build and by `adoptInlineMounts` at run time. `musicDir` and
`sfxDir` read that folder first and the engine-wide one second, so every zone not yet re-packed plays as before, and the
generated audio table is unchanged until a re-pack is pinned. One key in two places refuses the build.
