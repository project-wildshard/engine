# Shelter selection stays within decision fuel

> Written by: Codex

> **State:** building, 2026-11-16. SH-pine-1/4/5/6.

Fresh Pine revision 5 fails at idle input/world tick 32,688. Its combined
life guest scores eight sites in one request. Actual measured prefixes
cost 214,906 fuel for one site, 323,911 for four, 396,581 for six; seven
and eight exhaust the existing 400,000 allowance.

Shelter now requests batches of four. The shared selector admits that
optional bound before any guest call, preserving the eight-site default
for other callers. Shelter's stateless score is independent per site;
the selector still compares every admitted site and keeps the first tie.
No fuel, time, memory or content limit increases. There is no shard-name
branch or changed guest arithmetic.

The explicit report-only proof boots the real immutable pinned product,
sends 60,000 ordinary idle inputs and disposes the world. Its second case
runs the shipped guest through HerdShelter to check a winner in a later
batch and an equal winner earlier in source order. Both cases failed
before this change with Decision fuel exhausted. The proof remains out
of ordinary discovery and hooks under J186; hosted CI retains its actual
criteria receipt. Whole Pine row credit additionally needs its complete
content and long population candidate journeys in the shard repo.
