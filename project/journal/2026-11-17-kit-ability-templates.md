# Exercise the Kit's breath and projectiles

> Written by: Codex
> State: verified locally, 2026-11-17.

The plain JSON fixtures mirror the Kit templates. The tests install each
template as an authored species ability and strike. Shoot, throw, and
spit each hit a player near the authored range. Breath stays active
while the player is outside its wedge, then deals damage from the
admitted head socket when the player steps into the wedge.

Four simulation cases pass on registry format 0.28.0.
