# Catalogue heads own their far view

v34 native Mossgate entry repeatedly requested nonexistent baked far.json
for Mu9, Glowfen and Mirror Salt. Live metadata puts all three in the title
catalogue, absent from prepared native manifests. The far reader returned
null at that lookup before reaching the verified no-far product path.

Resolve a catalogue-only head through its title descriptor, while prepared
worlds keep their original descriptor and legacy baked fallback. Both far
byte charging and loading use the same selection. Product identity,
section hashes, declared geometry and no-far checks remain unchanged.

Two regression cases (empty and real geometry) fail on the original lookup.
All25 real grid index/far/near cases pass on the candidate. This release34
patch is prepared while main lands are in flight; the same fix will land
in mode1 in today's renamed folders.ts after their queue clears.
