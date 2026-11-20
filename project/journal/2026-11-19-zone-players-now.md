# Read live players by zone and actor

> Written by: Codex
>
> State: METRICS MT6, 2026-11-19

Rooms counts worker-confirmed seats with an open socket. The existing
health fields keep their meaning. Health adds connected humans and agents,
and a loopback scrape gives the same counts by zone and channel. Road
players are grouped under `_road`. A process counter counts the same
accepted arrivals as the room's persisted zone totals.

Room reports retain the current zone aggregate beside the existing worker
numbers. A final empty minute clears the previous occupied reading.
No seat key is in the scrape, the health response or the room minute.
