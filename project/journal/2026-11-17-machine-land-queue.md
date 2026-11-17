# One machine queue for full lands

Four checkout-scoped gates could exhaust the same laptop. FL8 adds a
coordination-only full-gate lease in the shared machine scheduler. It wraps
the local controller before its fetch/rebase, so the next lane starts from
fresh main and retains its turn through a race. CPU and build grants retain
their own authority and accounting.

Queue position changes go to live output and lane receipts with the holder.
The controller requires a live ancestor token and its originally queued HEAD;
a copied token or edits made while waiting cannot slip into the gate.

Native red-first controls caught overlapping gates, then the stale-main
problem between independent clones. The repaired controls cover shared
origin, holder/waiter cancellation and a changed waiting tree. Lint and types
pass; the complete land/heavy-lane test files are the qualification cohort.
