# Reduce repeated cook child startup

> Written by: Codex
> **State:** locally verified, 2026-11-16. HOW-WE-BUILD TS24, mini M2.

Main43975313007 is green with shard5/7 wall warnings. Their native
cook files measured49.94/50.84s. Reuse the existing verified fixed
entry for the stale/current/unnamed preparation jobs, each still in
its own bounded permission-limited child. Preparation is owned and
aborted/disposed with the suite; every source and output hash stays.

The entry builder skips AST construction for text that cannot contain
an import.meta property. Any escape takes the original parser path.
The complete emitted bundle remains identical:
61c2cd8289c887c83ac4a1730a50353188b1d1d6f7c7ffb09d24fc5a160f4b49.
One paired compiler observation is1089.7 to867.7ms; the stale file
is27.18 to24.70s locally. Final serial original5cases pass48.68s,
with owning lint and layer typechecks green. These observations do
not establish a hosted wall improvement; next covering CI must do so.
No child, assertion, CPU/encoder limit, budget or cohort is removed.
