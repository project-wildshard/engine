# Admit the real C transport fixture as native work

Release source e5c315e passes full CI but Ring1 42791889349 shard7
(job129747376417) times out during cc compilation at the original five
seconds. No transport assertion was reached. The wrapper/Python/C inputs
are unchanged since the initial engine lift; this was never lift-pending.
The same unchanged source passes later on 6fce8c2, exact CI42792846367 and
Ring1 42792846303. There is no deterministic host-compiler root reproduced
and no quarantine or rerun requested.

Classify the real C/loopback-host fixture in a native singleton. Remote
native dispatch uses one outer worker, avoiding competing ordinary Node
imports during the short compile. Existing local admission grants native
files two real slots instead of the ordinary one. That is an admission
refinement, not a compiler optimization or proved fix for every slow host.

The existing compiler deadline stays five seconds, child deadline ten,
outer case fifteen, CI file sixty and shard three hundred. All four
Python transport/refusal controls and the same Vitest boundary remain.
The native transport witness still cannot impersonate an owned Safari
frame. No browser, simulator, C, Python or gameplay source is changed.

Fresh local original Python controls pass4/4 in1.293s. After grouping,
the original Vitest wrapper passes1/1 in1.88s under an actual two-slot
CPU reservation. Selected typed lint passes. Actual planner discovery
retains1201full files/12shards/max233.978383s and1117Ring1files/8shards/
max224.816376s, including setup and the unchanged factor/headroom rules.
Actual phase discovery, normal full push and hosted successor follow;
no Linux repair or complete-row claim is made before those receipts.
