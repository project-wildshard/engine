# A late placed pack keeps its frame

MA10k (meta MINI-AUTONOMY-MACBOOK). On v0.1.43 staging a placed cell's
pack arrived after the cell the file lists after it. The door numbered
placed cells in the order their packs opened, while the page numbers
them in the file's order, so the two disagreed about which frame was
which cell and both clients read wrong neighbours until a restart.

A placed row now carries its slot: its place among the file's cells
that a page adds after the catalogue, computed with the page's own
admission rules. The door, the upload activation and every worker
number a placed cell from that slot, whatever order the packs arrive
in. The red test opens the middle of three rows last and checks the
door, a worker booted from the door's list and the page agree.
