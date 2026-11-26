# The tap names the zone (opus-chunk, meta CHUNK-PARAM-REMOVAL CP1, J522)

- A Zone Select tap already wrote its zone in the tab (`titleArrival`, 60 s) and then navigated to `/?chunk=<zone>`: the
  address was a second copy. Travel now leaves for a bare `/` with the harness flags it kept; the receiving page reads the
  tap with no slug (`pendingTitleArrival()`), in the entry (`adoptTap`, the boot's own `search`, never the address), in
  index.html's first paint (a tap on `/` is a world page, not the title) and in the registry (`setPageZone`, set by
  `prepareSelectedShard` before the running manifest is first read).
- The device copy (iOS's WebContent swap) used to be safe to read on any page, since only a `?chunk=` page asked for it. On
  a bare `/` another tab could take it inside the minute, so it is read only on a same-origin `navigate`
  (`tapNavigatedHere`): a second tab, a bookmark and a reload have no same-origin referrer or are no navigation.
- `?chunk=` reads stay until CP22; nothing breaks in between.

# A tap is its next document's only (opus-chunk, CP1 fix forward)

- 954b06fec let any bare `/` with a fresh tap enter, so a tap the world page had not yet spent (the player leaving for the
  title while it loaded, exit to main menu) sent that title back into the world (title-first-paint's SB44 "leftover tap"
  case). A record now carries `from` (the writing document's start) and `taken` (the start of the first other document
  that reads it, stamped by index.html's first paint): a later page in the tab finds it taken and stays the title. SB44's
  engine update reload hands the taken tap on, as before, without writing `chunk` into the address.

# The first paint and the read-ahead read the tap (opus-chunk, CP2)

- index.html's loading clock named its zone from the address; it now takes the record this document took (`taken` equals its
  `performance.timeOrigin`), so a bare `/` the tap navigated runs the card's clock and name from the tap. The boot-fail
  report's zone and `entryTransport`'s read-ahead read the same zone. A `?chunk=` still works until CP22.

# The engine's own reloads carry the zone in the tab (opus-chunk, CP3)

- A one-shard page now has a bare address too (CP1), so each reload the engine makes hands its zone to the next document
  with a tab tap (`handZoneOnReload`, the zone from `setOneShardZone`, set by the session; null on a grid page, whose
  recovery record resumes it): RELOAD HERE in Settings and in the error modal, GPU recovery, the stale-deployment reload.
  The seat-elsewhere reload already wrote its tap; it no longer writes `chunk`. Debug's clear-downloads reload drops it.
- `at` and `glreload` stay on RELOAD HERE and GPU recovery: a pose, not a zone; CP22 decides them with the rest.

# Crash resume and grid recovery boot from their records (opus-chunk, CP4)

- The entry wrote the record's zone and `glreload` into the address before booting; the boot now takes `recovery.slug ??
  crashResume.slug` in its own search and the address only loses a stale `at`. The session already resumes from the record
  (`session.recovery`), so `glreload` was redundant there. `<html data-resume>` marks the resumed page for the journey proof,
  which read the address. `?crash=revision|seat` name the running level, not the address.

# The world's door hears the picked cell in a word, not the address (opus-chunk, CP5)

- Jake's Q3 (a): the page dialed `/?chunk=<cell>&at=spawn`; it now dials the bare address and says `goto {cell, spawn}` before
  its hello (`gotoFirst`, every dial), only once the door's first word says `goto: 1`. An older door would close `refused` on
  a prefix it doesn't know, so against one the hello goes alone and the page is seated where the world keeps it (Q3's stated
  cost for the deploy window, either way round). The door dropped `gotoCell` and `gotoSpawn`; a bad word is counted, not fatal.
- The client's hello waits for the door's first word only on a page with a cell to ask for (at most 3 s), so nothing else moves.

# The doctor and a note name the zone without a link (opus-chunk, CP7)

- The doctor's address carried `?chunk=` from the page's own; the page's address names none now, so the zone rides in the
  same-origin handoff the page already writes (`doctor.earlier`, `zone` from the alive beat's `runningZone()`).
- A review note sent `repro`, a reload link with `?chunk=`; it sends `zone` and `pose` (or Explore's view) as fields instead
  (`filedAt`). The drain-inbox skill reads them in meta CP18.

# The deep link's PLAY and the running zone (opus-chunk, CP6 and CP8)

- CP6: the `/slug/<slug>` page's PLAY already left through `travel`, which since CP1 goes to `/` with the tap; only its comments
  still said `/?chunk=`. Explore's path zone goes into the boot's own search (`exploreBootParams`), never the address.
- CP8: the registry's running zone is the one the entry set (`setPageZone`); `shardSlugFromUrl` and its address read went, and
  `prepareSelectedShard` takes the boot's zone. The standalone app's strip keeps dropping `v` only. Comments that described the
  param say what is true now.

## CP9: the journey proves no address names a zone

The Zone Select journey used to wait for `?chunk=<slug>` after PLAY. It now waits for a new document at `/` that
started with a tap record naming the picked zone (an init script, `journey.ts` `startTapScript`, copies the save blob's
`titleArrival` before the boot claims it), asserts each address has no `chunk`, and records every main-frame navigation and socket URL, failing if any
carries `chunk=`. On a working-tree preview the FEATURED and POPULAR entries pass the new wait; the NEW tab has no
enterable card in that build (its zones are not in the local pins), an assertion that runs before PLAY and is
unrelated to the param.
