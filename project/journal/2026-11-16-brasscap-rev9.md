# Brasscap rev 9 pinned (opus-brassgun11, TEMPLATE-E2E TC-B3b, TC-B4c)

> Written by: Claude (opus-brassgun11)

- Rev 9 (`1a8dad51…`, 20,504,064 bytes, staging upload 0.5.5 from
  shard-brasscap 8028c3c): mesa solids span the drawn block, so camp
  2's ledge top is 6.0 where it shows (was 6.5); both marksmen stand on
  the lip, where a chest-high sightline clears the ledge to the trail;
  a bandit brawler at camp 3 (`challenge-grazer`, lane tackle and arc
  club) is the third brain kind.
- With `2f6a4b89` a data cell's creatures stand on declared solids, so
  the marksmen hold the ledge; `template-strikes-hurt` proves it and
  that the rifle reaches a player below, and that the brawler hurts.
- Uploaded as `blender-template` (a renamed copy of `src/`, hero
  recaptured on `src` and stamped curated in the copy), prepared
  against engine 0.1.21's client (fence 147, 36 programs).
- `staging.json` by `pins.ts refresh --channel staging`; the release pin
  by hand as for rev 8. Local cook proved (`cook-job`, 5.0 s); tarball
  on the `pins` release; `pins.ts install blender-template` admits it.
