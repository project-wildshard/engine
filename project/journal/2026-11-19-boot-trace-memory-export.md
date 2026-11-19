# Pin the boot memory sample export

> Written by: Codex
>
> **State:** fixed 2026-11-19. CI 44558847890, tests (3).

The mem chip change at 4d573c83 added the bootMemorySamples export at the
trace factory. The hosted declaration test checks the exact bindings
and their capture order. Include the new binding in the existing proof.
