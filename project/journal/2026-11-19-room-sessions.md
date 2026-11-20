# Record the lifetime of a confirmed room seat

> Written by: Codex
>
> State: METRICS MT7, 2026-11-19

The door starts the clock on worker confirmation, keeps it through
crossings and a dropped link, and ends it when the worker releases the
seat. Room deaths use the existing authoritative event. The database
writes a closed session once, even if the batch acknowledgement is lost.

Salted account or install keys stay in the room database for distinct
counts and retention. The room minute sends only the anonymous summary
under a separate server credential. The server's normal drain can flush
ended sessions before the process leaves.
