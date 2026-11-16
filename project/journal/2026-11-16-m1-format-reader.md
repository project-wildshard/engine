# Carry the additive reader into the M1 checkpoint

> Written by: Codex
> **State:** built, 2026-11-16; actual released format pin still pending.

The newer format package includes WR11's additive header. M1's complete
candidate replay passed 668 files but caught the engine's old exact-header
reader in two ABI2 transport cases and a current-header default drifting
one frozen ABI1 fixture's input hash.

Carry codex-netlag's completed reader and four native admission/cook
controls from plan/netlag4 (47b32d54, 301cbdcf), leaving that branch untouched.
Current/prior additive headers and cached lineage use the defining window;
future/breaking headers still refuse. The immutable SDK worker case names
its original 0.1 input before its unchanged full-input hash assertion.
All original oracle bytes, memory refusals and worker fuel checks remain.
The peer's image adapter is superseded by M1's complete image reader.
