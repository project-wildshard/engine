# Preview: continuous deploy and a git describe label

> Written by: Claude (opus-preview-cd)

- Jake, 2026-11-12 ~22:55 Cancún: "Why is preview not continuously
  deployed hourly from the engine btw why is it still 0.1.13?" GitHub's
  cron fired 3 times in the 24 h to 22:41, so preview sat 4 h on one
  build. Jake's design (~23:08): every green main `ci` triggers
  preview.yml (`workflow_run`), whose first step ends the run when the
  live preview's version.json `time` is under 60 minutes old. The
  schedule is gone; a hand dispatch deploys at once.
- "Still 0.1.13": the title pill and WHAT'S NEW box named a build by
  package.json's version, which only moves at a release. A build now
  names itself by `git describe --tags --match v[0-9]*`
  (`v0.1.13-100-g5a43d1c4`, Jake: "make the preview version use git
  describe"), baked into `__ENGINE_RELEASE__.describe` and version.json's
  `describe`. Plan: docs/plans/opus-2026-11-12-preview-cd.md.
- preview.yml: `workflow_run` on `ci` (main, push, success) plus the
  dispatch; the "At most hourly" step reads the live version.json `time`;
  concurrency `preview` no longer cancels a run mid-release; the checkout
  fetches tags so `git describe` sees v0.1.x.
- The plan (PCD1 to PCD5) is docs/plans/opus-2026-11-12-preview-cd.md; PCD3 (a 75-minute lag watchdog), PCD4 (proof) and PCD5 (meta architecture) stay open.
- PCD3: scripts/preview-lag.mjs finds the oldest green main past the live preview that changes a client input (preview.yml's list); over 75 min it checks in error to Sentry Crons preview-lag and dispatches preview.yml. First run 22:57 Cancún: BEHIND 240 min (243820b7), the hand run was already going.
- First workflow_run run 43364023216 (23:12 Cancún) passed the gate (live 269 min old), named itself v0.1.13-112-g13d0d1fd and failed on the shard-size phone ceilings, like the 22:48 hand run. The gate's deploy message printed the epoch after the minutes; fixed.
