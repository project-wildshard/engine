# DL24: creature programs warm before control

> Written by: Claude

J198: "warm shaders before control", no frame after control over 250 ms. Far Reach's 390-406 ms Simulator frame,
13 s after control at boost, was one program: the storm roc's rig (a spawn-only slate variant, colour transform
`far.roc-slate`) built in the frame it first drew, 153 m out. The phone-loading play window names it now.

The boot prepared only the spawn table's models and compiled only what the scene held, and the server's rows arrive
after both. `RowBodies.stageWarmRigs` now parks one hidden rig of every model a row can bring (the spawn table's kinds
and the level's registered species, spawn-only variants included), with its one-draw shadow caster, after the composer
is built. The first frame's parked draws warm every hidden pipeline no shown drawable covers, so the rigs build under
the loader as counted units.

Two wrong turns, both measured. Parked before the compose, the rigs took Far Reach's haze world patch, which the compose
puts on the scene's materials once; the rows' rigs never get it, so the key differed. Taken out after the first frame,
the residency released their materials and three deleted the programs; the roc rebuilt the same 705-character key at
13.4 s. They stay parked, hidden, for the level's life.

Readings on 4f31a1d (before) and the patched tree (after), Far Reach, select flow, 20 s walk then boost:
- WebKit: before +1 program at 13.4 s (cold and warm), longest 48 ms; after +0 programs, roc drawn at 217 m, longest
  46/48 ms.
- Chromium 10x CPU: before +1 program at 13.4 s, longest 100 ms; after +0, roc drawn at 216 m, longest 81.7 ms.
- Boots of seven shards in Chromium and five in WebKit reach ready with no errors; 0-26 rigs, +3 or 4 programs each,
  0.1-0.5 s more to ready on this Mac.

The first push gate failed finish-composer-order: its fixture had no `animals`. The fixture now records the staging,
after the composer in all three orders.
