# Standalone progress-save test clock

> Written by: Codex
>
> **State:** verified 2026-11-18. TE-ENG8 and main-watch M2.

The quest test in run 44339095464 observed a durable write, then failed
its wall-clock assertion at 1,226 ms. The real server drops excess
catch-up ticks during a stall. Record the simulation tick when the page
writes its continuation and keep the one-second limit in simulated time.
Allow up to five wall-clock seconds for delivery, well before the page's
30-second save interval. The field and quest tests still dispose the
first worker as soon as the write lands and reload from that storage.

A controlled 1,250 ms event-loop pause failed the old quest assertion
at 1,263 ms and passed with simulation ticks. All six progress-save
integration and scheduling tests passed.

Buddy-engine's 9a0e2e13 moved the timestamp to the storage write. This
keeps that boundary and uses the server's ticks, so a stall before the
page handles the write cannot by itself spend a simulated second.
