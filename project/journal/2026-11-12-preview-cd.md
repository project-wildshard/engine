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
