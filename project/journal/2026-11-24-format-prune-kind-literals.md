# FP42: the engine names no creature kind again

> Written by: Claude (opus-prune2), 2026-11-24.

`engine.kind-literals` read 28 against its 24 ceiling: shard-format's ratchet read the frozen M1 engine, so the rise
passed CI. The one new runtime literal was cooked taming's `['poses', 'horse']`: it now takes the pose from the looks
row of `server/taming.json`'s first kind (Nalati: horse, then the argymaq upgrade). The rest were doc examples and a
default aim kind; they now say `kind`. The ratchet itself moves to today's mains in shard-format.

## FP43: the engine stops reading the format's page homes row

No pin names `population.homes` any more (Dunes r8 and Sky Reach r8 dropped it, FP37 and FP38). The engine used to convert
an older pin's row into its own `engine.page-homes` row and read trail groups from it; now it refuses the row, drops the
conversion, the group lookup and the boot-module alias, and a trail names its members. shard-format can then retire the kind.
