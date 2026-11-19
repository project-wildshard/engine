# Keep NPC figures visible after grid warm-up

Brasscap rev 9 shipped the sheriff's visible, 372-triangle panel and
the staging CDN returned its GLB. Engine `1a9fdc62ad` hid every panel
for compilation and restored only those with a field or mover.
Restore each panel's authored visibility before applying live state.
Admit cells with static panels even if they have no mover or target.

QA feedback 2026-11-19 row 38. Headless phone WebKit on staging
found both declared meshes in Brasscap's scene, with zero draws
for the sheriff and the wanted poster. Both local NPC cases
failed before the fix and 14 related tests passed afterward.
