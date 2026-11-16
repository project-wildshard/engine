> Written by: Codex
> State: J206 MUST corrected and qualified locally, 2026-11-16.

The review found a real caller-lifetime mismatch: e2e-client starts a
detached warm watcher and exits after ready. Ordinary command ownership
would stop it on caller loss and charge CPU during ten idle minutes.

Keep the watcher's existing heavy ticket under an explicit official
service route. Admit CPU for startup imports/preparation and each bundle
plus finish interval; the Vite buildStart barrier waits before rebuild
work. Preview/control serving stays alive while idle without CPU slots.
The first interval may borrow its requester's real ancestor budget; after
completion that capability is removed before future independent work.

An active interval belongs to the actual private-group service, not its
pipe helper. Only explicit completed-work acknowledgment releases it.
Helper loss cannot discard a live service row, and owner loss retains
capacity through verified group shutdown, including resistant children.
Unacknowledged completion fails. Store pruning returns a not-yet-delivered
grant without stopping the idle service. Arbitrary service commands refuse.

The actual official e2e-client ready returned and exited; a later ready
reused the same live watcher. Its idle interval admitted an exclusive
grant. A real source-triggered rebuild queued behind that grant, resumed
after release, advanced the generation and released its CPU row. The
watcher and preview were then stopped. Three additional real service
completion/helper-loss/owner-loss controls and all fifteen command edges
pass, along with the original eight heavy cases and ownership regressions.
Normal full pins restore the generated inputs after the Template smoke.

This resolves the single review MUST. Full room qualification remains
TS22d; older worktree clients and other unmetered work are not a claim of
total-machine exclusivity.
