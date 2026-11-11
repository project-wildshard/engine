# New test files no longer fail the planner (LS2 fix)

After LS2, branch CI failed in "Plan the smallest useful shards" whenever
a branch added or split test files (opus-vh10's run 42976764127,
ts5-splits2). The error was `No shard count meets 90% gain…`. A new file
has no clock until main's next run measures it, so it was charged 60 s.
Before LS2 the gate forced a committed timing first. Nine such files, some
in a doubled native group, pushed the floor over 240 s on every shard
count.

Fix (coordinator call within J258): when the floor is over budget only
because of unmeasured files, the planner charges them the measured median,
takes every shard and prints a warning. A floor over budget on measured
files alone still fails. Reproduced on vh10's tree with the cache that run
restored (`timings-42975567617`): the old planner throws; the new one
plans 15 shards and names the 9 files.

J206 review MUST: the failure is judged on the measured files alone (new
ones at zero), so a median estimate never decides a failure either.
