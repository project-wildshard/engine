# QA 15. Include both maps in a checked upload

J450 draws maps from admitted world data without an author map. A write
failure used to produce a successful cook report with neither map listed.
The worker now gets a successful cook only after both sizes are on disk.
Its existing order publishes the loose files before the checked index.

The cook regression verifies a non-flat Brasscap map with no declared
look/map. The isolated upload worker test checks both stored PNGs and
index keys for a shard with no map section. A blocked output path fails
the map step.

The v0.1.52 phone WebKit Bag drew all 28 live cells from the atlas and
runtime maps. Its widest preset is labelled 1x. The 0.25x reading
belongs on the build carrying the new Bag zoom controls.
