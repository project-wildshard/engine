# ?time= on every sky (QA 11-24 row 60)

> Written by: Claude (opus-qa24)

Only a painted sky read `?time=`; keyed day clocks (Pine's sky, Driftwood's faceted day, toon skies) read `?tod=` (a
phase) and only Settings counted `?tod`/`?clock` as the URL's pick, so on staging a `?time=` link did nothing. Now
`runDayClock` reads `?time=` the way the painted sky does (an hour, or a day part, a row phase or a Time of day pick),
mapping the hour through the clock's own law, and Settings counts `?time` as the URL's Time of day.
