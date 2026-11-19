# 2026-11-19: the released Nalati save resumes on revision 4

Lane: buddy-engine (keeper, J443; MAIN RED dfb768cd02..358255d52f, run 44549600522, tests (8);
red 21 min with the pin's lander unreachable).

5b3605526 pinned nalati-grasslands revision 4 (5c1f9b8d…), but the released v0.1.1 save fixture
still named revision 3 (1a1c8a4f…) as the pin it resumes on, so released-save-play's first check
(the fixture names the current pin) failed. Unlike Brasscap rev 9 this morning, Nalati's level
did not change: on revision 4 the save still resumes in place and keeps walking. The fixture's
`pin` moves to revision 4; all ten released-save tests pass locally.

The same run's slice red (pins.test.ts, boundaries) was opus-tr4b4's 9a7d7df91.
