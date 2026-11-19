# Count confirmed zone arrivals on the MMO server

> Written by: Codex
>
> **State:** METRICS MT4, 2026-11-19.

J467 counts a confirmed Zone Select seat or walk-in. The door
keeps the actor it learned on the socket and waits for the worker.
Minutely batches update local Postgres by channel, zone and day.
The batch id protects retries and daily visitor keys use a separate
keyed hash. Each key groups a signed-in account or a guest seat.
