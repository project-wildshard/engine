# Driftwood rev 2 and Pine rev 3 pins

> Written by: Claude (opus-uploads3), 2026-11-13

- Meta J331 release slot. Both were built from clean clones, prepared in
  phone WebKit on a `WILDSHARD_PREPARATION_ONLY` preview of engine
  `95d4718b` (renderer `1ecb1f74`), and uploaded with
  `wildshard upload --channel staging` (preview and staging move;
  production moves with the release that carries these pins).
- Driftwood Isle revision 2 (`bc397b42`, v0.0.1, shard-driftwood
  `71200e6`): AU17 dropped the unused folk and orchestral tension music
  (0.83 MB). Fence 266, 113 programs. Ring 1's step chain is unchanged;
  the slice is re-cut (`a02e44c7`) and both tarballs are on the `pins`
  release. The v0.1.1 save resumes on it.
- Pine Hollow revision 3 (`e3d45004`, v0.0.2, shard-pine-hollow
  `eeb8fec`): AU17's audio cut (7.15 MB of folk and orchestral music,
  phone audio now 5.24 MB, green), opus-pinehero's spawn-road card, and
  a fresh hero capture after SA11's renames, which had left ring-2's pack
  refusing a stale hero. Fence 505, 116 programs. Ring 1's step chain is
  unchanged; the slice is re-cut (`931b62c4`) and both tarballs are on
  the `pins` release. The v0.1.1 save resumes on it. Players need an
  engine with `93e50340` for its spawn ground (v0.1.17 and later).
- Superseded the same day (opus-uploads3b, meta QA 2026-11-13 row 34):
  revisions 2 and 3 were prepared over the previous heads' `public/`
  audio, so their fences held no recordings and
  `test/download-audio-list.test.ts` went red (see
  `2026-11-13-stale-public-mounts.md`). Heroes recaptured
  (shard-driftwood `3087235`, shard-pine-hollow `6aa54ee`, since UP4
  refuses a rising version with the same hero), rebuilt, re-prepared on
  a preview of `da8accb9` with their own mounts published, and uploaded
  to staging: Driftwood revision 3 (`6fdd4f67`, v0.0.2, fence 284, 18
  recordings) and Pine revision 4 (`1b6dcfb1`, v0.0.3, fence 509, 4
  recordings). Slices re-cut (`56b8c4af`, `f4ac068f`), all four on the
  `pins` release; ring 1's step chain unchanged; the v0.1.1 saves
  resume.
