# Template rev 7 pinned (buddy-engine, T1E-9 / MG18)

- Mossgate rev 7 (`21ad259a…`, 16,310,272 bytes, sharddev main
  a91b3b0) is the preview and staging head; engine pinned rev 6.
- `pins.ts refresh --channel staging` moved `test/pins/staging.json`:
  template 6 -> 7, and blender-template 3 -> 7 (Brasscap, already rev 7
  in the release pins).
- The release pin is by hand again, as for revs 4 to 6: plain
  `pins.ts refresh` reads production's live heads, which are older
  (template 3, blender-template 3, far-reach 1), so it would have
  rolled three pins back. `shardfiles.json` and `catalogue.json` take
  the rev 7 row; the tarball is now on the `pins` release.
- Ring 1's template chain is re-recorded (`69c447f7…`, only template
  differed); Darwin and Linux held the same chain, so linux-x64 takes it
  too. The v0.1.1 Template save is refused by rev 7, as by 5 and 6
  (`saves/template.json`).
- `pnpm pins` admits all 27; boot stamps unchanged. The template's
  preparation reads as stale (an older engine prepared it), which only
  logs.
