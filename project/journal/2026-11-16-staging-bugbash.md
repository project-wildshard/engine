# Staging bugbash, opus-ss16o (2026-11-16)

- SB7: staging v0.1.30's pill read `v0.1.28-96-g…`: the release built before its tag existed, in a checkout without
  v0.1.29. `changelog.mjs` `releaseDescribe` names the release commit `vX.Y.Z` and a commit past it `vX.Y.Z-n-g<sha>`.
- SB9: the Graphics card, DRAG TO MOVE and the mic tip showed together. The card holds the hints and the first voice tip
  back until DONE or until it has faded to rest (10 s).
- SB5: locally the reveal already began under the card; the judge's "blank" was the 3 s sky-down flight (HUD held
  back). `journey-proof.mjs` now labels it `arrival` and fails a blank over 500 ms. For staging's case (canvas still
  hidden past the card), `Loading.ts` `holdLoadingVeil` leaves an inert still copy of the finished card up until the
  reveal's first frame, 4 s at most, and only when the world comes next (not a title-first page or a pause menu).
- SB8: the drop modal after a leave-and-return came from `dropNotice.take` on a fresh page with the world's breadcrumb,
  not from an `unexpected` end. `lastEnd` marks such a page `left` (page before ended visible, plain navigation, no
  same-origin referrer); the game's own unmarked hop still shows the modal. Rests on no Referrer-Policy being set.
- Review (`claude -p`): MUST was the veil over a title-first page; fixed with the hold's `wanted`. SHOULDs taken: the
  release label past the release commit, the card's cap, comment placement, the referrer note.

- SB27 (opus-ss16p): the title SETTINGS never opened on staging v0.1.30 or prod v0.1.29. `readDiscovery` read each row's
  `/shardfiles/<slug>/discovery.json` from the page, which 404s since PAGE-SIZE put shard content on the content base, so
  `completeCatalogue` rejected and `openTitleSettings` never opened. It now reads `contentURL(row.discovery)`.
- SB10 (opus-ss16p): the staging mark sat on the move stick and ATTACK in play and on the last Settings row. It is now one
  word, STAGING, at the top left under the HUD Settings button, and in the strip above an open menu sheet; the full sentence
  is its accessible name. T1 phone spec mounts the real rule and words and checks no tappable control under it.
- SB14 (opus-ss16p): mid-swipe ghosting on Shard Select was the off-middle card at opacity 0.55 showing the hero through it.
  Cards off the middle are now dimmed with a filter (solid), `place` lights the card nearest the middle while a finger drags,
  and the snap is 0.24 s. T1 journey spec swipes with CDP touch and checks one lit solid card per frame.
