# 2026-11-16: Brasscap Mesa's slug is brasscap-mesa (TC-SHIP-a)

> Written by: Claude (opus-brassgun14)

Meta TEMPLATE-E2E TC-SHIP-a, on the coordinator's ruling (Jake objected to
"Blender template" as a name, QA-FEEDBACK-2026-11-15 row 33). shard-brasscap's
Actions publish uploads under its own identity slug, `brasscap-mesa` (0.5.5,
rev 3, `79d71535`), while engine pinned the old API slug `blender-template`
rev 9. Staging's API grid already names brasscap-mesa at (-1, -1) (opus-brassgun13,
the admin grid PUT). `shard-pin.yml` refuses a slug engine never pinned, so this
is the reviewed first pin.

- The catalogue key moves: `singleplayer.json`'s grid and solo rows,
  `test/pins/shardfiles.json`, `catalogue.json` and `staging.json` (refresh).
  The instances keep their names (`blender-template`, `blender-template-solo`):
  the box's rooms, worker weights, crossing ratchets and every save slot are
  keyed by instance, so a player's saves stay where they are, and staging's
  grid row matches the baked one.
- `slugNames.json` and `pages/slug-names.ts` now map a retired slug to its
  replacement: `/slug/blender-template` still 302s to `/slug/brasscap-mesa`,
  and the page reads the old path as the new slug.
- The released v0.1.1 save fixture moves to `test/pins/saves/brasscap-mesa*`
  and names `formerSlug: blender-template`. Its world snapshot names the old
  level, so the new world refuses it whole and the grid carries its flags
  (`carryRefusedSave`), as for any changed level.
- `blender-template` stays where it means the format's own handwritten
  Template 2: Ring 1, `--from-format`, `pin-format.ts`, the determinism corpus
  case and e2e's product (which now borrows brasscap-mesa's pinned row).
  `test/pins.test.ts` lets Ring 1 name it with no API head.
- Left as is: the profile ledger keys achievements and entitlements by shard
  slug, so ones earned under blender-template stay in the profile under that
  name and brasscap-mesa's count from zero (meta TC-SHIP-g).
