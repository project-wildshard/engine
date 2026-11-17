# Admit browsers through the CPU broker

J402 BR1: a browser is a four-core request (or the smaller machine
budget) and one of two browser owners in the ordinary CPU ledger.
A third browser waits even when CPU cores remain. A browser waiting
for its resource does not block ordinary CPU work behind it.

An already-held ancestor budget can cover a browser. Validate that
capability in the actual child, retain the ancestor relationship,
and charge any parallel browser weight beyond the ancestor budget.
Already-budgeted work can pass a fresh CPU request blocked by that
same ancestor, so an exclusive test cannot deadlock on its browser.
Existing stale, forged and sibling capability refusals stay intact.

The native control failed first: the old broker admitted three
four-core browser requests into a twelve-core private budget.
Controls now cover two owners, a waiting third, ordinary work,
weighted accounting, release, cancellation, an exclusive ancestor
with a fresh request waiting, and an actual killed child owner.
All eight cases in six focused files pass, including the existing
36 ancestor controls. Lint and TypeScript pass.

Launcher integration and the machine-wide live announcement follow
in the same J402 cohort. This core alone does not govern existing
browser launchers and has not been landed independently.
