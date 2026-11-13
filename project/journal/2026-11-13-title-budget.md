# The title's JS ceiling goes to 160 KB gzip (opus-titlebudget)

> Written by: Claude (opus-titlebudget), 2026-11-13

Main CI went red at `467a3b4d` (run 43445543581, ring1 build): `title gzip 110142 exceeds 110000`. MK9's static
`installViewport()` import put `viewport.ts` (~900 B gzip) in the title's static closure, and later commits took it to 110340
on `f2a636b3` (ring build in a worktree, `scripts/check-chunks.mjs`; raw 316 KB of the 350 KB raw ceiling).

A lazy `import()` of `viewport.ts` with its own chunk got it to 109563 and passed its tests, but Jake settled the question
instead (J324, 2026-11-13 ~10:33 Cancún: "if the title page needs to be bigger than 110 kilobytes, then let's make the title
page bigger than 110 kilobytes. A 1 megabyte title page is fine."). So `lint/ratchet.json` raises `js/title/gzip` to 160000
and `js/title/raw` to 500000, MK9's static import stays, and no chunk layout changes. The forbidden-module rules (no three,
rapier, shard code or generated modules in the title) are unchanged.
