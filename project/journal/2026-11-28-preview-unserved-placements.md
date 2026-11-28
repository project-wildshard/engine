# Preview's catalogue placed zones its borrowed table lacked

> Written by: Claude (opus-ship, fix-preview PV22)

Preview went live at 78ae9605c, its first page reading zones from the cook. A tab held from the previous
build still played. Every new session failed at boot: "Discovery of open-plot-desert-ruin answered 404".

The cause was a mismatch between the page's catalogue and its zone table:

- The catalogue (the pins, or preview-grid's borrowed grid) places two hidden solo plots,
  open-plot-desert-ruin and open-plot-thin-ice.
- The zone table borrowed from staging's signed release and placement file names neither.
- Their discovery rows pointed at cook keys the page had no row for, and the boot reads them.
- The go-live check only HEADed what the table named, so it passed.

Preview was put back on the previous Worker version (e1571f9e, build 18c0bc5b) by hand.

The fix:

- `zone-table.mjs build --catalogue=<file>` adds each cell the baked catalogue places, at the catalogue's shard
  version. A placed cell with no version is refused by name. preview.yml passes the grid's catalogue.
- `zone-table.mjs check --catalogue=<file>` refuses a table that misses any placed cell. page-release's preview
  check passes the catalogue it bakes, so a page like this one can't reach go-live again.
- Run against the 78ae9605c table, the new check refuses it, naming both plots. The table rebuilt with the pins
  has 27 zones, and all 27 cooked indexes answer 200.

Coordinator, 11-28: the go-live check passes the catalogue on every channel. Preview passes its grid's catalogue;
staging and production pass the pins they bake. The live tables pass it today, each checked against its page's own
`/catalogue.json`:

- staging, serial 166: 27 zones, 24 placements, 27 indexes and 1361 objects answer 200.
- production: 27 zones, 24 placements, 27 indexes and 1319 objects answer 200.
