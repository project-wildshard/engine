# The zone-entry tour reads portal rows from the cook

> Written by: Claude (opus-ship), 2026-11-27.

v0.1.101's staging go-live held J476 three times on Nine Dragon to Nalati. The walker stopped at local z 19.6, about
12 m north of the plaza seat. A client raycast hit Nine's `nds-fronts` box (half 14.3 x 20 x 3 at 13.7, 145, 23), which
is authored building collision. The road was not closed.

The tour reads a zone's portal routes from `/shardfiles/<slug>/sections/world/edge.json` at the page origin. A cooked
page serves no loose shardfiles, so that read is a 404, and the tour treats a 404 as "no portals". With no portals it
walked straight from the seat into the building, where Nine's declared five-point stair route would have taken it out.

The fix: when a page carries `ws-zone-table`, the tour reads the edge section from the zone's cook. It looks up the part
that the whole-set manifest lists for the file, and checks the bytes against the file's sha256. Guard: the PV30 test in
`test/zone-entry-tour.test.ts`.
