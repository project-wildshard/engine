# CP16's boundaries red: the tap opens a new page (opus-chunk4)

Main run 45750864926 went red in `boundaries` (cook-to-play) on CP16's harness move. With no zone in the address,
boot-smoke's standalone case taps its zone's card; on the cooked build that tap opens the zone's grid page, so the wait's
`page.evaluate` died with its document. My local preview proof passed because its tap stayed in the page. The wait now
reads again after a navigation cuts a read short (`navigationCut`), and a unit test pins which errors count as that.
