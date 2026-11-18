# Load named creature clips through format 0.27

> Written by: Codex
> State: verified locally, 2026-11-17.

The engine pins the published format 0.27 package at release commit
9ddd7e76b8. Its renamed graph budget option keeps the same access
decision. The newly admitted leap row has an explicit refusal until
the M4 runtime implements it.

Creature skin variants sample admitted names through the same mixer.
Both the SkinDriver and giant clip authority resolve mapped state names,
fall back when a variant lacks the mapped clip, and keep timing tied to
the state. Running ability replication is still a separate wire step.

Named strikes use a socket from the admitted skin, transformed through
the actor root or the existing animated collision pose. The contact
shape and cover query share that origin. Unnamed strikes retain root
contact. Before the test fix, the animated socket witness expected an
unscaled distance. The model's measured displacement now follows scale.

Frozen install, lint, typecheck and 38 cases across eight files passed.
