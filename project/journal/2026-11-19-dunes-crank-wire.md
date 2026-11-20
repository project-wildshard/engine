# Dunes crank: the grid kit was off the wire (OF19d)

- Staging v0.1.53, Dunes rev 4: a real heavy whip crack at the crank turned the page's well prompt to "Take the oil jar", but
  the server never set `sunscar.oil`. The server was right: a headless sim with the page's exact input (held or tapped HEAVY,
  the look's pitch) raises the crank from every stand. The miss was the page's: on the grid Dunes is an entered regional
  runtime, and `regionalRuntime.ts` bound its kit with no wire, so the whip ran its own contacts. The page cracked the crank
  alone and predicted the oil; the server never heard the lash and the well's `unraised` denial is silent.
- Fix: a cell with a native runtime plan (Dunes, Far Reach: the server runs the held weapon) binds its kit on the road's wire,
  as a data cell's kit does (TC-E1b). Proved on `pnpm dev --staging` with a headless page walking to the crank: the heavy goes
  out, the server's crank row runs, the well gives the oil. Standalone (`pnpm dev --shard sunscar-dunes`) was already wired,
  which is why local runs never showed it.
