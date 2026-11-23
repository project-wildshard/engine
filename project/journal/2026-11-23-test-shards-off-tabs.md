# Test shards stay off the player tabs

QA 11-23-b row 26 (J453): staging placed hidden test shards (Pastel Plain, Ink-Cel Valley) on the grid and Popular and New
listed them. One predicate, `offPlayerLists`, now hides hidden, `_`, proof, retired, open-plot and named test shards on the door
and again on the page; Developer mode's All keeps them. api-server's grid PUT refuses them on a cell.
