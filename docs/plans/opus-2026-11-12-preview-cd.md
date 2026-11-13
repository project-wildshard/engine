# Preview deploys continuously, at most hourly, and names its real build

> Written by: Claude (lane opus-preview-cd)

> **State:** in progress, 2026-11-12. Auto-approved by Jake ("auto approved mini plan on engine"); builds with no
> review stop. PCD1 to PCD3 built; PCD3's hourly caller, PCD4 and PCD5 open. Meta HOW-WE-BUILD row WL19 points here.

## Why

- Jake, 2026-11-12 ~22:55 Cancún: *"Why is preview not continuously deployed hourly from the engine btw why is it still
  0.1.13?"*
- Jake, ~23:00: *"Also make the preview version use git describe please."* His `git describe` gave
  `v0.1.13-100-g5a43d1c4`.
- Jake, ~23:08, the design: *"on every green CI on main, we attempt to do an hourly deploy as a dependent github action,
  but that github action checks the last deploy, and if the last deploy is within the last 60 minutes it ends early…
  auto approved mini plan on engine"*.

What was wrong, surveyed 2026-11-12 22:41 to 22:55 Cancún:

- `.github/workflows/preview.yml` ran on `schedule: '17 * * * *'` (J274). GitHub's cron is best effort. In the 24 h to
  22:41 Cancún it fired 3 times (02:24, 12:37, 18:41), so preview sat on `243820b7` from 18:43 for 4 hours.
- The title's build pill (`src/client/engine/ui/Update.ts` through `buildLabel` in `buildCheck.ts`) and the WHAT'S NEW
  banner (`src/client/game/whatsNewBanner.ts` `versionLabel`) named a build `v<package.json version> · <sha7>`.
  package.json only moves at a release, so every preview between v0.1.13 and v0.1.14 said `v0.1.13`.

## Rows

| Row | Work | Done when |
|---|---|---|
| PCD1 | **Trigger: every green main `ci`, at most hourly.** Done 2026-11-12 (`6c3e0300`). `preview.yml` runs on `workflow_run` of `ci` (`branches: [main]`, `types: [completed]`); the job runs only for `conclusion == success` and `event == push`. Its first step, "At most hourly", reads the live `https://preview.wildshard.io/version.json` `time` (the live build's build time) and ends the run when that is under 60 minutes old; an unreadable time deploys. The `schedule` is gone. `workflow_dispatch` (optional `sha`) skips the gate and deploys at once. Concurrency `preview` with `cancel-in-progress: false`: a release is never cancelled mid-flight, and a newer run replaces a waiting one. The old "client inputs unchanged since the live commit" skip stays | A green main `ci` starts a `preview` run whose event is `workflow_run`; a run within 60 minutes of the last build logs `under the hour, no deploy` and ends in seconds; a run after the hour deploys and `preview.wildshard.io/version.json` names the new commit |
| PCD2 | **Preview names its real build by `git describe`.** Done 2026-11-12 (`5bf81a02`). `scripts/changelog.mjs` `gitDescribe(root)` runs `git describe --tags --match 'v[0-9]*'` (`v0.1.14` on a tagged commit, `v0.1.13-100-g5a43d1c4` between tags; the `--match` keeps the lightweight `server-staging-*` tags out). `engineRelease()` carries it as `describe` into `__ENGINE_RELEASE__`; `scripts/app-build/versionFiles.ts` writes it to `version.json` as `describe`. The build pill and the WHAT'S NEW banner show the describe alone; a tree with no git or no version tag falls back to `v<version> · <sha7>`. The preview checkout fetches the whole history and tags (`fetch-depth: 0`, `fetch-tags: true`). **Label format:** exactly `git describe --tags --match 'v[0-9]*'` of the deployed commit, e.g. `v0.1.14-3-g6c3e0300`; the build time stays in `version.json` `time` | `test/changelog.test.ts` pins both labels; the next preview's `version.json` has `describe` matching `^v\d+\.\d+\.\d+(-\d+-g[0-9a-f]+)?$` and the title pill shows it |
| PCD3 | **Watchdog: preview more than 75 minutes behind green main.** Script built 2026-11-12; its first run (22:57 Cancún) said `BEHIND: live 243820b7; green cd84604a went green 240 min ago`, checked in `error` (Sentry 202) and saw the hand run already going. Open: the coordinator's hourly tick must call it. The hourly gate leaves one gap: a green main that lands inside the hour and is the last push for a while stays undeployed until the next green `ci`. Add `scripts/preview-lag.mjs`: it reads the live preview's `version.json` `build` and the newest green main push `ci` run; when that run's commit changes a client input (the same list as preview.yml) since the live commit and finished more than 75 minutes ago, it checks in `error` to a Sentry Crons monitor `preview-lag` (project `wildshard-game`, interval 1 hour, margin 15 minutes, notifications off, J252) and runs `gh workflow run preview.yml`; otherwise it checks in `ok`. The coordinator's hourly tick runs it (meta `plan-progress.py --hourly` or the F3 watchdog), so a missed tick also shows in Sentry as `missed` | With preview held behind on purpose (a dispatch of an older `sha`), the script reports the lag, Sentry shows `preview-lag` in `error`, and the dispatch it starts brings preview current; on a current preview it checks in `ok` |
| PCD4 | **Proof over a few hours.** After PCD1 and PCD2 reach main: three or more `workflow_run` preview runs over at least 3 hours, at least one deploy and at least one early exit, and the live label equal to `git describe` of the deployed commit | The `gh run list --workflow preview.yml` table and each live `version.json` (`build`, `describe`, `time`) pasted in this row |
| PCD5 | **docs/architecture.** Meta `docs/architecture/` names preview's trigger as "every green main ci, at most hourly" (not the `:17` cron) and the `describe` field; rebuild the PDF (`node docs/architecture/build.mjs`) per the 2026-11-11 rule | Meta commit with the changed files and the rebuilt PDF |

## Seams

- `preview.yml` is the only workflow that releases preview; staging and production (`server-release.yml`) are untouched,
  but their builds now also carry `describe` (a production build on its tag reads `v0.1.14`).
- `test/title-layout-browser.proof.mjs` expects the describe label when the tree has one.
- A hand dispatch queues behind a run that is mid-release (`cancel-in-progress: false`); cancel that run first if a
  dispatch is urgent.

## Verification

- `pnpm exec vitest run test/changelog.test.ts` (labels, the real tree's describe shape).
- `actionlint .github/workflows/preview.yml`.
- The live path is PCD4: `workflow_run` runs on GitHub and the bytes `preview.wildshard.io` serves.

## Sync

- Meta `docs/plans/HOW-WE-BUILD-PLAN.md` row WL19 points here; meta QA-FEEDBACK-2026-11-12 row 49.
- Meta `docs/architecture/`: PCD5.
