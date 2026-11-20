# Count authoritative game events by room and actor

> Written by: Codex
>
> State: METRICS MT8, 2026-11-19

The room reads deaths, quest transitions and boss outcomes from the
simulation event bus. A quest book emits transitions with its owning
body. Boss events use the encounter's active player. The door resolves
the actor, counts the event and discards the seat identity. Live zone
visits add an exit and elapsed seconds when they finish.

Counts go to the room daily table in retry-safe batches. The existing
trusted minute sends the anonymous counts to the Worker. A two-seat
room fixture runs a quest and a boss, ends a visit and reads both the
minute record and the durable counters.
