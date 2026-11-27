# 2026-11-27 Keep the build-owned files on the versioned staging page

PV25's first signed-channel build had a 27-zone table and passed the
page-size gate. The strict PV17 join then refused 54 files that the
size report groups with shard content. They were boot tables, the
world map, grid seams and strips, the engine's manifests, and the
server book and part for the build's road. The server book had an
empty shard map.

The strict join recognises these generated names and verifies that a
server book contains only the grid before admitting its part. A test
uses filenames from the refused build and verifies that adding zone
art or a server shard makes the same join fail before moving files.

Local staging QA now builds the signed-channel layout and runs the
strict join before booting the existing loopback rooms. It retains
the layout logs even when this preflight refuses the cut.
