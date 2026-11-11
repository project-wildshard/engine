# Vercel deployment prune for play, staging and the probes

- Meta VERCEL-SPEND-PLAN (Jake, 2026-11-11: "storage pruner on all
  repos"). deploy.yml's prune runs only on pushes to `nightly`, so it
  has never run since the split, and agents publish play
  (`wildshard-e7`) and staging by hand through
  `scripts/staged-deployment.py`, after which nothing prunes. Both
  projects grew to 15 GB and 31 GB a day of storage by 11-10.
- New `.github/workflows/vercel-prune.yml` sweeps every hour:
  `wildshard-e7` keeps 5 promoted, staging 3, the worker and wire
  probes 1, and every live or aliased deployment. A stage waits 24
  hours, since a release stages hours before it promotes.
- `scripts/prune-deployments.mjs` is now repo-kit `f6a55e0`'s shared
  copy (same exports, adds `--project`, `--keep`,
  `--staged-grace-hours`), and `pnpm check` runs
  `scripts/vercel-prune-check.mjs`: a workflow that deploys to Vercel
  without the prune step goes red.
