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


The native repaired page also exposed a second boundary: those sections
are packed, and the existing fallback first probed their absent loose
copies. The prefix itself is correct. A real member-layer regression
reproduces the unwanted404 while still receiving valid part bytes.

For placed uploads, try the existing verified part inventory before the
loose request. Published loose headers still work, missing files still
return404, and unrelated built-world routing stays unchanged. This
transport repair is included with the catalogue lookup on main and34.
