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
