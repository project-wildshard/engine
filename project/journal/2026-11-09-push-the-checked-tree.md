# Bind the actual pushed refs to the checked tree

Opus MUST-FIX2 reproduces against the clean published7490d38 source with
two actual Git protocols. First, HEAD's value2 passes the fixture's whole
configured gate and caches a proof. Git then pushes explicit value1 SHA:
the old real run-checks entry reuses HEAD's proof and publishes untested
value1. Second, an actual push waits behind an actual global full-test
lease. A value3 commit lands during that wait; after release the old gate
checks value3 but Git publishes its already selected value2 target.
Both independent old-source cases reproduce a successful wrong publish.

Every push-tree capture now resolves all non-deletion local ref SHAs and
requires each tree to equal checked HEAD's tree before any cache read or
work. Annotated tags resolve through their actual tree; different commits
with identical trees remain valid. Invalid refs, a different target tree
or a dirty publishing checkout refuse. The shared capture is called by
both run-checks before lease acquisition and push-checks after acquisition,
and again after the complete selected gate. Tree/runtime changes after a
gate now fail, instead of quietly omitting the receipt then publishing.

The same explicit-SHA and real lease-race fixtures are green afterwards:
neither wrong target reaches the remote; correctly checked targets still
publish, including actual exact-tree reuse and a fresh real leased gate.
The fixture uses the real run-checks entry, real heavy-lane implementation,
real Git remotes and its complete single-value gate. There is no mocked
Git result, skipped gate or production receipt copied into the fixture.
The manual proof is outside hook/Vitest discovery and under ten seconds.
History/secrets, full fallback, assertions and every timeout stay intact.

The first commit's manual process holder lacked a declared child type,
which the whole script typecheck catches as TS7034/TS7005. Explicitly
type the optional cleanup owner and capture the concrete child in its
callback. This is a type-only forward; both real protocols stay unchanged.

The one-shot review also catches empty refs on an up-to-date actual push.
The real repeated Git push is red on reviewed684176e and green after
skipping an absent ref list. This authorizes no target or skipped gate.
Its other SHOULD is retained as a testing limit: the race fixture checks
the real entry and capture with its complete tiny leased gate, rather
than negatively testing the production whole-suite post-gate guard.
