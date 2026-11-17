# Check the asset inputs before DS22 writes stamps

The land helper accepted a pins ledger after the files it named were
gone. Engine `668494d3` stamped that checkout and dropped 10,192 table
lines. The clean-copy pre-push read the complete assets and refused
subsequent pushes until `4a7ba050` restored the stamps.

Before generation, land now checks that assets tracked in Git are
present in the checkout. It requires a current pins manifest and
verified boot asset mounts in a tree that tracks the public asset
pins. A stale ledger or mismatched mount stops before any stamp or ref
changes. The diagnostic names the missing input and how to restore it.

Real Git reproduced the unwanted stamp commit first. Four incomplete
inputs now leave the prior stamp and both refs intact. A complete
checkout still regenerates the table and lands it.
