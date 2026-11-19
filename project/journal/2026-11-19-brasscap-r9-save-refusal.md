# 2026-11-19: the released Brasscap save is refused on revision 9 too

Lane: buddy-engine (keeper; MAIN RED 0af052588e..bcc114f78a, run 44516511227, tests (4)).

9bd26ace1 pinned brasscap-mesa revision 9 (56414c67…), but the released v0.1.1 save fixture
still named revision 8 (cc491ce0…) as the pin it is refused on, so the test's first check (the
fixture names the current pin) failed. The fixture's `refused` now names revision 9.

The intent is unchanged and was re-proved, not just re-recorded: on revision 9 the save's level
fingerprint still differs, `HeadlessSimulation.create` refuses it whole, and the standalone grid
opens a fresh world and carries the probe flag. All ten released-save tests pass locally.
The same run's tests (5) red (land.test.ts, the ci.yml shares) is codex-ci21's.
