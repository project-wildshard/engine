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
