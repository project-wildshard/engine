# Preserve pending scripted victory credit

> Written by: Codex

Nalati's Titan records its world victory during the current tick. Personal
credit settles at the next tick. A snapshot between those two steps used to
lose the pending credit after restore.

Snapshot v6 keeps the pending flags in their original order. Restoring leaves
the award for the same tick, so the player books still get one award each.
Version 5 and older snapshots retain the credit that their writers recorded.
An absent pending field means there is no queued award to restore.
