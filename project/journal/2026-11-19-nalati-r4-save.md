# Nalati rev 4: the released save resumes, 2026-11-19

- opus-netlag13: 5b3605526 pinned nalati-grasslands rev 4 (5c1f9b8d) and
  test/released-save-play.test.ts went red on tests (8): the v0.1.1 save
  fixture still named rev 3 as the pin it resumes on. Re-proved on rev 4
  with the pins installed: the save resumes in place at tick 30 and walks,
  so the fixture's `pin` moves to rev 4 (not `refused`).
- The "grid.runtime.nalati-grasslands.animals ... reading 'bones'" lines in
  the same log are test/sentry-automated-faults.test.ts replaying S21's
  staging fault on purpose, not rev 4's animals losing their skin.
