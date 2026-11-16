# Brasscap rev 8 pinned (opus-brassgun9, TEMPLATE-E2E TC-E6)

- Rev 8 (`5677f04f…`, 20,502,016 bytes, staging upload 0.5.4 from
  shard-brasscap 10aec06) adds the coin table: bandit 3 to 6,
  wyrmling 2 to 4, drake 4 to 8, the Wyrm 25. Engine 87280bf9 makes a
  grid data cell's kills pay it.
- Uploaded as `blender-template` (the placed cell): a copy of `src/`
  with the slug renamed, hero stamped curated, prepared against engine
  0.1.21's client (fence 147, 36 programs).
- `staging.json` by `pins.ts refresh --channel staging`; the release pin
  by hand as for rev 7, since production's live heads are older.
- Local cook proved (`cook-job`, 7.6 s); tarball on the `pins`
  release; `pins.ts install blender-template` admits it.
