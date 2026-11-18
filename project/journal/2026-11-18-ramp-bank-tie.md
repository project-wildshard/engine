# Driftwood's ramp corrections are a terrain-bank-and-wall tie (NET-LAG NL14b2, opus-netlag6)

- Staging sprints that reached Driftwood's ramp (-5, 6.3, -105) corrected 5.7 to 11.3 times a minute, page and room 1 to
  7 cm apart. The room's colliders and terrain match the page's bit for bit; with identical worlds and identical commands
  the wire probe still parted 3 to 5 cm, alternating every tick.
- Cause: under the cove cliff the feet stand on a terrain bank just past the 40-degree climb, against a crag's box wall.
  The controller meets bank and wall inside its 2 cm skin at time 0 and slides off whichever its query tree visits
  first, the same tie NL13b4 fixed for flat floors. NL13b2's slope-and-wall retry skips terrain, so it never applied.
- Tried, not kept: treating the bank as a walkable slope (the feet climbed it); taking the bank's normal from the tie's
  own contacts (still order-dependent); a ray under the feet (finds the floor below, not the bank at the side).
- Kept: `slideOffBank`. A grounded move whose static contacts are only a terrain bank and a wall measures the bank from
  the capsule (the nearest terrain point to its lower sphere), starts `2 * skin / n.y` higher so the bank is two skins
  away while the wall stays as close, and falls back inside the move. On a bank past the climb limit the push into it is
  dropped, so it is not climbed. Limiting the retry to steep banks kept every recorded law but left 8 of 192 sweep runs
  correcting (up to 5.6 cm, a climbable bank by the same wall), so the retry takes any bank.
- Numbers: the Driftwood press parts by 0 in seven collider orders (6.46 cm on the old motor; `net-predict-bank`).
  A 192-run wire sweep (three start rings, eight headings, sprint and walk, two frame patterns, two host orders): 0
  corrections, against 12 runs (up to 5.6 cm) before.
- J280: moves the eight motion traces, both Nalati room-bytes digests and Ring 1's template walk (the other seven Ring 1
  shards step the same). With the retry off all match the old records; re-recorded, repeat runs the same, and Linux takes
  the same template chain. The allocating control fixture has none of NL13b2's slope retry either, so it stays as it is.
