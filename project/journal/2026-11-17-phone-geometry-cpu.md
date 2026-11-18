# Retiring the phone's draw-only CPU geometry

> Written by: Codex
> **State:** 2026-11-17, ENGINE-MEMORY EM27. Draw-only retirement verified. Pine's 30 MB target is open.

The phone keeps uploaded positions and indices while a registered CPU reader
needs them. The Explorer registers the geometry it can pick. Skinned, morphing,
and changing shape data keep their existing CPU readers. A static position needs
its culling sphere before retirement. Geometry that has yet to upload retains
the input for its first draw.

The renderer remembers the vertex and element buffers separately. A late CPU
read restores the original typed array through WebGL's copy-read binding. Parked
draw planning can read the index type without pulling its bytes back. Desktop
continues to retire the same vertex channels as before.

| Phone Low at control, engine `0dc1166d` with and without this change | Before [H] | After [H] |
| --- | ---: | ---: |
| Nalati root-scene geometry backings | 32.37 MB | 17.06 MB |
| Pine root-scene geometry backings | 52.93 MB | 42.72 MB |

The current boot ratchet's read counts backing stores reached from the live
root scene after two seconds at control and a forced GC. Both boots reached
their worlds without browser errors. Phone Low spawn captures retained the
scene composition. The dedicated M1 `geometry-cpu` ledger is still in work.
The interim scene read excludes detached caches. It is a different sample
from the older loading heap census.

Pine still carries 21.67 MB in stores first found under a hidden node and
12.63 MB first found on skinned rigs in the control-scene census. Those groups
overlap. The large remaining Pine crag and cabin buffers still have CPU arrays
at spawn. Removing them before their first upload requires a different source
representation or a first-use loader.
