> Written by: Codex
> State: borrowed command lifetime qualified locally, 2026-11-16.

A nested build spends an ancestor budget, but its command must remain
visible after that ancestor releases or dies. Register its lifetime
against the verified active ancestor outside the FIFO. Count it within
the live parent budget; when the parent disappears, keep charging the
command until its authenticated group drains. This also composes through
multiple nested borrowers. Validate ancestry outside the scheduler lock.

Twelve real controls cover direct and broker parents, ordinary completion,
release and hard-killed providers. A spare slot remains usable during
borrowing, proving there is no second budget. Exclusive work stays
blocked through an ignored-TERM descendant after parent loss. The first
hard-kill control exposed pruning against a stale token inventory; remove
reclaimed tokens during the same pass. No observation deadline changed.

Termination now snapshots authenticated group members before TERM and
checks surviving identities before KILL after reap. A reaped handle alone
never authorizes a signal. All four ownership/ancestor wrappers, lint and
types pass. Production heavy-lane integration remains the next unit.
