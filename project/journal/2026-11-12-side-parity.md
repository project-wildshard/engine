# Page vs room colliders (SERVER-PARITY SS1)

- The rope bridge (NL5, f5424420) was one case of a class: the page builds
  solids from its product, the room builds its own, and nothing compared
  them. `test/side-parity.test.ts` boots each of 7 pinned shards through
  `openCellWorld` (the room's composition, whole solids) and diffs every
  collider, as (owner, material, box rounded to 1 m), against the page's.
- The page half needs the production bundle in Chromium, so it is a
  recorded fixture (`test/side-parity.page.json`, 510 KB), refreshed by
  `node scripts/side-parity.mjs --record`. CI checks the live server
  against it on every run. A page change can go stale until re-recorded;
  that is the trade for running in plain Vitest.
- Matching: same owner and material, box within 1 m (2 m for a dynamic
  plank). The page streams solids near its player, so a server-only
  collider counts only inside 50 m of the page's player. A collider that
  matches only by shape under another owner is a lesser finding: both
  sides stand on it, but hits, sounds and interactions read the owner.
- At f5424420^ (bad7799f) Driftwood fails: "bridge (wood, dynamic): 16
  page collider(s) with no server match". On main every shard passes
  with its open gaps listed under `known` in `test/side-parity.allow.json`,
  each owned by a meta SERVER-PARITY row; closing a gap means deleting its
  line, and any change fails CI.
- Found on main: Driftwood's moored boat has no server collider at all
  (HS2); a page-only castaway collider at the origin; Nalati's server bake
  carries no owner or material on any solid, and 113 of 146 forest trunks
  sit 3 to 5 m off or shorter; Nine Dragon's 16 edge floor pieces are
  page-only; Pine's solids all agree, three under other names (its cave
  included).
- Review fold (one-shot `claude -p`): matching is one to one (half a
  plank chain was green before), a missing page position throws, every
  row records its Rapier shape type and a shape with no measured box
  fails, and finding examples are the smallest box, not world order.
