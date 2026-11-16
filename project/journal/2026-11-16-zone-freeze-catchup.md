# Freeze the queued catch-up step at a zone gate

> Written by: Codex
> **State:** prepared, 2026-11-16. Mini M2 main-red fix forward.

Main43961757496 failed dedicated-zone-enter: a frozen player drifted
0.07057m against its unchanged0.05m limit. RoadRoom filtered ordinary
commands, but NetRoom had already filed an extra catch-up command in
SimHost.commanded. That second movement bypassed the road's filter.

Park the whole player at accepted entry. Native ordinary and catch-up
phases both exclude parked players. Unpark on explicit thaw, timeout
and release; a returning seat must never inherit a stale parked id.
Keep the motor collider and the existing led wire flag intact.

The original socket test now also flushes a six-command delayed-page
burst during both original input legs. Before the fix it fails with
0.48003m drift; the original refusal, freeze and one-socket assertions
and0.05m bound stay. No timeout, budget or oracle is relaxed.
