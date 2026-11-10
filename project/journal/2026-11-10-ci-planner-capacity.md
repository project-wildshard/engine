# Give full CI enough shards for the measured work

CI 42913107468 stopped at the planner on a637ad0. Real discovery found 1,232
blocking files, all with weights. With the existing 70-second setup allowance,
1.35 factor and serial native phases, even ideal packing needs 244.962 seconds
at 12 shards. The actual packing needs 244.995. Trying a different packer
cannot put the same work under the 240-second planning ceiling.

The same inventory models 231.543 seconds with 13 shards and 220.000 with 14.
Full CI now considers up to 14 and prefers the smallest eligible plan with
ten seconds of reserve below 240. If none reaches that target, the existing
90 percent gain and 240-second eligibility still apply. Ring 1 still chooses
seven shards, with a modeled maximum of 236.914 seconds. The file deadline,
job deadline, weights, fallback and test membership stay in force.

An earlier exact CI/Ring 1 pair, 42897821576 and 42897821643, reached 20 active
engine jobs. The full test matrix retains its former maximum of 12 concurrent
jobs, so the extra logical shards can queue. The organization keeps its
20-job limit. Actual hosted jobs will measure the extra wave and push-to-green
time. The local plans report the duration of each job after it starts.
