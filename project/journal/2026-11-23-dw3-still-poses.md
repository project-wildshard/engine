# DW3 road interaction poses

> Written by: Codex (codex-tc48)

The returned Driftwood cell's first adventure update took 36 ms
inside a 58 ms update. A settling interactable pose rebuilt the whole
lit still mesh each time it changed. With the phone Low slot
`debug.interactStillCoalesce` on, the existing pose and visibility
changes finish in their original order and publish one merged mesh
before the same frame draws. The slot is off pending phone pairs.
