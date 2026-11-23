# J500 rule 3: no far placeholder within one road cell of its zone

> Written by: Claude (opus-compat-w12), 2026-11-23

Jake's road clips on staging v0.1.74 showed Signal Dunes' far proxy as a flat brown wedge at
arm's length and Nalati's as a grey wall across the road. A far proxy drew whenever its near view
was not covering it: on the phone only the nearest four cells planned a near view, and while a
near view loaded the proxy stayed up. Now (`nearPlaceholderPlan.ts` `nearReach`, `farDrawnAt`):

- within one road cell of a zone's square (the road's width, its diagonal at a crossing) its far
  proxy and its haze band are hidden every late frame (`session.ts` bands);
- a cell inside that reach stays in the near plan past the phone's four-cell limit.

Rule 1 (opus-finish, `d418d0aad`) keeps the zone just left resident on its road; rule 2 (an early
full load before the gate) is opus-finish's too.
