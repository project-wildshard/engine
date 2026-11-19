# 2026-11-19: the released Pine save resumes on revision 6

Lane: buddy-engine (keeper; MAIN RED 4d573c8351..ffe31ce9ca, run 44560975372, tests (4)).

fdb2ae992 pinned pine-hollow revision 6 (86c0ecc5…), but the released v0.1.1 save fixture still
named the earlier revision (2afc6270…) as the pin it resumes on. On revision 6 the save still
resumes in place and keeps walking, so the fixture's `pin` moves; all ten released-save tests
pass locally. The same run's tests (8) (Pine's audio rows name piano music the engine table
lacks) is the other half of that pin, which codex-ms is tracing; this commit does not touch it.
