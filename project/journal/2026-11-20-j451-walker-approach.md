# The J451 smoke walker budgets its swim and steps round pillars

v0.1.54's J476 smoke held at 10 of 16: six "walker timed out on the gate
approach". A real player was never stuck. One staging guest on 6bab8fcc
swam from Driftwood's pier to its east approach in 168 s at about
2.6 m/s, then reached Nalati's gate. v0.1.53 ran the walk-all tour, which
starts from the road and never had a fresh guest swim the harbour. The
smoke starts each pair at its source's spawn, and that change missed two
cases. First, a flat 120 s approach budget is shorter than Driftwood's
harbour swim. Second, the walker only hopped when stuck, so
open-plot-2-0's centre pillar held it at z -1122.8 for the whole
approach.

The approach budget now follows the route's length at 2 m/s, with
120 s as the floor. A walker that stalls hops once and then side-steps,
alternating sides and stepping further each time, until it gains ground
toward its point again.

A third case came up on the rerun. mirror-salt's straight line from its
spawn to the west approach climbs onto a ledge and runs into a rock
wall, and side-steps don't clear it. A fresh guest away from Driftwood
now joins the gate's centre line on the gate's half of the cell, at
least HALF/2 from the centre, then walks along that line to the
approach. Joining the line at the centre stalled open-plot-4-2 on its
centre piece. Driftwood keeps its shore route.
