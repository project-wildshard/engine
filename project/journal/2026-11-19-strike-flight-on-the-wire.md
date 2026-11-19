# A creature's projectile flight on the wire (opus-of-m23c)

- ONE-FORMAT CC18c: a creature's strike can launch a projectile (`StrikeProjectiles`) the server sweeps for seconds,
  and no page drew it. Engine pins wire 1.5.0 (shard-format `3581853e`), whose event 16 `flight` carries tick, source,
  launch point, aim, speed and gravity. `launch` emits `strike.flight`; `CombatWire` turns it into a row; the room sends
  it to every client that knows the creature, as `died` goes.
- The page flies it by the server's law: `flightPoint` is `projectileFlightStep`'s semi-implicit step in closed form,
  so a fractional render tick lands on the same curve. `StrikeFlights` pools one ball per live flight; one ends at the
  ground, at a hit within 1.5 m of it, after 10 s, or at a crossing.
- Two gotchas. The sim's event bus is queued: a payload holding `slot.pos` was read after the step had moved it, a step
  ahead on the page. It now emits plain copies (a queued payload is also saved). And the flight is launched before its
  tick's own flight step, so a page counts `tick - flight.tick + 1` steps.
- Proof: `test/net-strike-flight.test.ts`, two pages on one room: both draw the flight within 0.2 m of each other, and
  within 0.006 m of the server's ball (the launch point's 16-bit metres), every tick of its flight.
- v0's frozen codec has no flight form and leaves it out. wire-released moves to npm 1.4.0; room-bytes digests re-taken
  for the welcome's event table.
