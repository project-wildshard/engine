# CP16's boundaries red: the tap opens a new page (opus-chunk4)

Main run 45750864926 went red in `boundaries` (cook-to-play) on CP16's harness move. With no zone in the address,
boot-smoke's standalone case taps its zone's card; on the cooked build that tap opens the zone's grid page, so the wait's
`page.evaluate` died with its document. My local preview proof passed because its tap stayed in the page. The wait now
reads again after a navigation cuts a read short (`navigationCut`), and a unit test pins which errors count as that.

Reproducing the boundaries unit locally showed three more layers. On the grid the tapped zone stood in a cell whose
instance isn't its slug (cook-to-play's world shows Brasscap in Pine Hollow's cell), and then the page fetched the
neighbours' spawn files, which a cooked-only build doesn't have. cook-to-play proves one zone's own bytes, so it boots
alone now, a one-cell world (Q1 (a)): `/` routed to a one-cell catalogue, `skipintro`, and the local-network grant a
routed document needs to reach the cooked store on its other loopback port. zone-entry picks the zone's own cell when a
world shows it in many. Boundaries unit green locally.
