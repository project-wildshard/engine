# CI21 headless relay

> Written by: Codex

> **State:** verified, 2026-11-15.

The main-side cell-home test arrived after H1 moved simState into the
public test harness. Point it at the same implementation in its new home
so the combined tree still types and exercises exact save continuation.
No helper body or assertion changes.
