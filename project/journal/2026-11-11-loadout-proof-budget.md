# The native loadout proof's cold case gets an honest budget

> Written by: Claude (opus-testspeed-lane)

Engine main went red on 2026-11-11 (ci 43069655147, tests (2), range
762822d5..60db3e56): "Complete native loadout proof exceeds 9.5
seconds". SC1's branch hit the same within ten minutes, for a change that
only touched a workflow file.

`test/ci/native-loadout.proof.mjs` runs inside the static unit of a
packed job, beside e2e. One 9.5 s wall budget covered all three cases,
but they are not alike. The first one pays the process's cold start
(the first native product load, Rapier's compile, the JIT): green hosted
runs took it 8.0 s, and the two red ones passed 9.5 s. The two warm
cases took 0.7-0.9 s on the same runners. On the Mac under a load of 56
the cold case took 15.8 s.

The first native proof in the process now has a 20 s budget (its
node:test timeout too); the warm cases keep 9.5 s. Every assertion and
both failure messages stay; the message now names the budget it broke.
TEST-SPEED TS11.
