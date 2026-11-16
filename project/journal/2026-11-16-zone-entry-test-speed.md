# Zone-entry proofs stop walking the same road twice (QA mini #61)

dedicated-zone-enter (50-63 s on main after e2a77079, 60 s budget) and dedicated-road-walk (45-52 s) both walked the
~70 m of plain road between Driftwood and Sunscar. road-walk keeps that one walk by input; zone-enter's first case and
road-walk's return now place the walker a few metres short of the edge and run it in. Hold and freeze windows halve.
Locally 42 s to 32 s and 41 s to 30 s; no assertion dropped. (mini-fixes, J389)
