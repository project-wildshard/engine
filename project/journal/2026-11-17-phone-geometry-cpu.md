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

## Fixed batches

The crag and forest batches already had their vertex buffers on WebGL at
control. Their owners can retire the vertex arrays after settling because
the batches keep each LOD part's native culling sphere. The native
multi-draw path still reads the index element size, so its CPU array stays.
Boot warming still clones the native batches. The retirement queue waits
for ordinary play before releasing them.

At the same Pine spawn on the same pinned product, the interim root-scene
probe [H] read 42.72 MB before the fixed-batch cut. The settled trial read
34.07 MB after play began, with Nalati steady at 17.06 MB. Trace sampling
identified the native index reads, so the final cut leaves those indices
resident from the start. The immediate control reading precedes retirement.
Pine's 30 MB target and the M1 CPU ledger proof remain open.
