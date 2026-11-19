# Ring 1 boots Brasscap, not the Template

J434 (Jake, 2026-11-18): the legacy Template and the hand-written
Template 2 go; Mossgate Hollow and Brasscap Mesa are the templates.
Ring 1's products were `template`, `blender-template` (shard-format's
`corpus/handwritten`, installed by `--from-format`) and `sunscar-dunes`.
They are now `brasscap-mesa` (a pinned API head, rev 7) and
`sunscar-dunes`.

- `pins.ts install --ring 1` no longer installs a format dependency.
  Its catalogue fills every cell it does not keep with a Brasscap road
  cell, where it used a `_template` one. Dropping those cells instead
  breaks the seam bake: its wire budget is `perHome` times the homes
  baked, and two homes allow 296000 B against a 898196 B set.
- Brasscap steps on the declared path: 240 ticks give 91c544936a151ab3
  on darwin-arm64, the same on three runs. The Template and Template 2
  rows leave `ring-digests.json`. Brasscap's chain is copied to
  linux-x64, whose chains have always matched darwin's (see
  2026-11-18-template-r10-ring-digest); main's hosted run checks it.
- The grid boot's durable crossing enters Brasscap's cell at (-1,-1)
  (instance `blender-template`, kept for saves) instead of the Template
  road cell.
- cook-to-play's build ships Dunes and the store attaches Brasscap. Found:
  Brasscap's store-attached phone boot stalls at the world step ("ground
  collider" done, world tiles waiting on 7 product reads in flight, no
  further store request) for 60 s, whether its build shipped Brasscap or
  Dunes; the bundled boot passes. TEMPLATE-E2E TR-3b owns it; until then
  the daily engine-boundaries run reads red at Brasscap.

Still on the Template pin, for TR-5: `nine-ring1.mjs`, `packs-contract`,
the memory ledger's server inputs and the T1 suite (TR-4).
