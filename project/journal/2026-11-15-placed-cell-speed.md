# Placed cells keep their road speed class (buddy-engine)

- QA 11-15 row 8 left one thing open: a cell the API places on a running
  box (SA33) lost its grid row's `speedClass`. The server reads no
  manifest, so `gridAssembly()` saw a road-class shard as a plain one and
  capped the board at 14 m/s, while the page (which reads the manifest)
  ran 30: corrections all the way across.
- The placement file's row now takes `speedClass: 'road'`
  (`placementRows.ts`), and `placeCell`, `placedCells()` and
  `gridAssembly()` carry it, so workers booted with the placed list get it too.
- The schema is a plain `v.object`, so an older box ignores the field and
  the API can start writing it whenever. api-server's
  `signing/placement-file.ts` still drops it when it builds the rows from
  the channel's grid; that half is api-server's.
- `test/placed-cell-speed.test.ts`: the row parses, `shard` is refused,
  and a placed road-class cell's interior caps at 30, a plain one at 14.
