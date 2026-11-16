# Bind a durable checkpoint to its actual admission

> Written by: Codex
> State: built locally, 2026-11-16; E7.2c.c.1, hosted proof owed.

A readWitness adapter drains the existing queue and reads the current
Postgres document. Only a current, unrecovered copy gets an internal
certificate. The worker verifies its complete document digest after the
actual successful import. Previous-copy fallback or receipt recovery
cannot reuse the certificate. No write queue or save acknowledgement
behavior changes, and no completion timestamp is invented.

The door emits the optional world9 status on that exact admission token,
only to that socket. Discovery fields remain, device:1 is not repeated,
and the status is bounded to512bytes. Engine transport carries an opaque
status; host-only checkpoint vocabulary stays in the host. Binary layout,
message prefixes, pings and hashes remain unchanged. Old readers ignore
this optional word; held-body rejoin performs no database read or witness. ZE9 arrival overrides
the persisted stand, so those relocated admissions have no witness either.

Five real PGlite/native controls cover restore, identity isolation, held
reuse, both recovery paths and provenance/size refusal. Existing durable
restart and wire frame/routing controls pass (12cases total). Normal lint
and types pass. No escape hatch. FM7b uses the same agreed status carrier.
