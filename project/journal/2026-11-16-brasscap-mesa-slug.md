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
  the box's rooms, worker weights, crossing ratchets and the grid's instance
  save slots stay where they are, and staging's grid row matches the baked one.
- A page keeps a shard's pack, owned items, coins and achievements under the
  shard's slug. At page entry each retired slug's namespace merges into its
  replacement (`SaveStore.mergeShardEntries`: entries already under the new
  slug win, the old namespace stays). An old `?chunk=blender-template` link
  (a bookmark, a tab reloaded after the deploy) reads as brasscap-mesa.
- The cell's saved world was revision 9 of blender-template and is revision 3
  of brasscap-mesa under the same instance, so its exact continuation reads
  as a future revision and is refused (`gridServer` reports it); the world
  opens fresh with the player's flags carried, as for any changed level.
  Creature health and positions in that cell start over.
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
- The profile ledger keys achievements and entitlements by shard slug, so ones
  earned under blender-template counted for nothing under brasscap-mesa. Since
  TC-SHIP-g the ledger's read carries a retired slug's entries under its
  replacement (the new slug's own entries win, the old ones stay), so the
  server's profile read and the next grant both see them. The retired-slug map
  moved to `src/shared/game/slugNames.json` (`game/slugNames`) for both.
  From its review: an entitlement also carries under the instance renamed (a
  dedicated room named after the old slug, or its -solo twin), and an
  achievement carries only when the reading ledger declares it, under the
  declared title and threshold, so a retitled one never trips the refusal.
- The land preflight could not pass with Ring 1's blender-template (the format's
  Template 2, installed by `pins.ts install --from-format`) in out/:
  `stalePinProducts` named it stale because no pin names it. It is now current
  while its index is the installed format package's, and stale once the format
  moves past it. An earned achievement carries full under a raised threshold.
- Branch CI found Ring 1 broken by the rename: its catalogue is cut from
  test/pins/catalogue.json, which now names Brasscap's row brasscap-mesa, so
  Ring 1's blender-template (the format's Template 2) lost its row, and the page
  rewrote `?chunk=blender-template` to a slug Ring 1 doesn't list. pins.ts's
  ring catalogue now names a renamed row by the retired slug the ring installs,
  the page keeps a retired slug its catalogue still lists, and
  pinned-restore-play walks brasscap-mesa outside Ring 1 (a plain pins tree).
