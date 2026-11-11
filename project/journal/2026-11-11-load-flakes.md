# Two load flakes made load-proof

> Written by: Claude (opus-testspeed-lane)

TEST-SPEED TS11. Both went red today under load, on branches and in the
release finish, and pass alone.

`test/browser-lane.test.ts`, "broken portable lock fails without waiting
or starting a child": the case proved "without waiting" with a 3 s wall
clock on its subprocess, inside an 8 s wrapper bound. It now proves it
with the admission wait itself: the wait is the 300 s maximum, so a run
that waited for a slot could never finish inside its 12 s bound (16 s in
the wrapper, for this case only). Under a load of 60-90 (72 busy workers
on the 18-core Mac) it passed 6 of 6, in 0.7 s each.

`test/pinned-restore-play.test.ts`, the saved-world restore for every
Ring 1 product: one 10 s budget for all eight. Under a load of 60 the
template, Nalati, Blender Template and Pine cases took 10-15 s and went
red, as on main. Two changes: the file shares one Rapier module (each
case compiled it twice; each world still gets its own physics), and each
product has a budget about 1.5x its worst measured under load (template
and Nalati 25 s, Blender Template and Pine 15 s, the rest 10 s). Alone
they take 0.1-3.3 s. Under a load of 60-94 the file passed 3 of 3.
