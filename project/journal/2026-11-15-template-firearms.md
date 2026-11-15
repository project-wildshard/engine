# Templates on the grid: creatures, guns and racks (TEMPLATE-E2E TC-E1)

> Written by: Claude (opus-brassgun), 2026-11-15

Jake played Brasscap on staging and found no gun and no enemies. The probe (shard-brasscap `kit/scripts/play-probe.mjs`)
showed why: a grid data cell drew only the creatures its client scripts bind (Brasscap binds only its sand-ring
particles, and its lane was refused because it reads a state field the neighbour page doesn't hold), so all 12 bodies
were on the wire and none on screen.

- TC-E1a: `NeighbourLife.admit` now draws every spawn with a skin look in a data cell, and a refused lane leaves the
  bodies drawn. A native cell still leaves its creatures to its runtime.
- TC-E1b: a grid data cell's declared items are in hand while the feet stand in it (`grid/dataCellKit.ts`). Entering the
  cell builds its `items` rows (kit families, item models) into one equipment service bound under the page's controls
  (`EnteredEquipment.bind`), wired to the server by the road's weapon wire; a lever follows the server's owned lines.
  Leaving gives the road's bare hands back. A rack's prompt (an item scene) is offered in the copy now (`copyPrompts`).
  Why not a declared client page (Signal Dunes' way): `held.melee` holds only a melee weapon and `held.ranged-page` is
  Pine Hollow's forest page, so a gun there needs new engine and format work anyway; this route is engine only.
- TC-E1c: the loadout's primary lever starts taken on the server (and after a restore), so it fires with no rack.
- TC-E1d: a rack's take of a lever already in hand adds its row's reserve again, capped at 999 (`RESTOCK_CAP`).
- The lever still never fired on the grid: the sky-down reveal (`grid/reveal.ts`) read the weapons' state when it was
  installed, under the title, while they were still off, and its end turned them off again after ENTER had turned them on.
  Bare hands hid it. It now reads them as it begins and gives them back only if nothing turned them on meanwhile. The
  entered kit starts as the road's controls stand. Local preview proof: Shard select and the road from Signal Dunes both
  hold the lever with 6 in the tube; one shot each downs `target.1` and `target.2` and the quest moves to camp 1; the rack
  raises the reserve 30 to 60.
- Review (one `claude -p` pass) found the kit copied the road's wire once, so a session that booted inside the cell left
  the road unwired after leaving. `EnteredEquipment.bind(kit, entry, { wire: true })` now hands the road's wire to the
  kit and back, and tells the server the road's held row on leaving; a later `bindWire` reaches both. Also: feet that
  entered before the cell's admission finished get the kit then; the lever ignores another cell's wire frames; a cell
  needs a weapon row for a kit.
