# Idle particle pools and copy panels draw less

> Written by: Claude
> **State:** pushed, 2026-11-17 (NINE-DRAGON-BENCHMAX NB8, mini-nb8d).

NB8 wants Nine's phone walk at about 100 draws; NB1's street route
read 113-119. A same-pose draw census on Nine's south street found
draws that put nothing on screen every frame: each herd view's blood
pool and the melee hit stars (parked or faded points, 0 px), and the
grid copy identity panels drew their plate and their digits as two
meshes.

A ParticlePool whose owner settles it (`settle(alive)`) now hides
once it has drawn while nothing is live, and `claim()` shows it
again. The first draw stays, so the program is linked before a
burst needs it (ZE3a measured a 65 ms link in frame). Blood, the
population splash, melee stars and ranged puffs settle; other pools
draw as before. Copy panels are one mesh with vertex colours, pixel
equal to the two meshes at 8, 20 and 60 m.

Same-pose draws: spawn 93 to 91, south street 108-109 to 104-105.
