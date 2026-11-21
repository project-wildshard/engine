# main-watch stops crying red with nothing broken

buddy-engine, 2026-11-20, build-max A5.

main-watch raised eleven red alerts today with no code failure under
them: seven were "no new failures", three were cancels, one an
artifact timeout. Each one pulled a lane off its row to look.

Two causes in `scripts/main-watch.mjs`:

- A cancelled run counted as red when any blocking job was
  unsuccessful, and `cancelled` counted. But a cancel leaves every
  unfinished job `cancelled`, so a run cancelled for any reason looked
  like a red one. Runs 44763550438, 44768998830, 44774041972 and
  44780910229 had no failed job at all. `cancelledJobs` now counts only
  jobs that failed, timed out or never started. FS24's early red still
  reads as red, because the job that tripped it failed outright (run
  44361972035 kept its failed tests too).
- Inside a red span, a new lander whose run failed only what already
  failed still got a MAIN RED message reading "no new failures
  reported". That run is now a `main still red` receipt and prompts
  nobody. A run with a newly failing test or job still prompts its
  suspect and its new landers, and the keeper's 20 minute clock is
  unchanged.

`ADVISORY_VERSION` moves to 8, so cached cancelled rows are judged
again under the new rule. The artifact timeout is not covered: it is a
real job failure as far as GitHub says, and telling it apart needs the
failing step's name, which is a separate change.
