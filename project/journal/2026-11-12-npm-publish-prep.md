# 2026-11-12: npm publish prep (NPM-PUBLISH NP1)

- Jake, 23:10 Cancún: "publish stuff to npm so it can be installed without git
  links". Plan: meta `docs/plans/NPM-PUBLISH-PLAN.md`.
- `@wildshard/engine` drops `"private": true` and gains `license` (UNLICENSED,
  today's all-rights-reserved state until Jake picks one), `repository` (trusted
  publishing matches it exactly) and `publishConfig.access: public`. Its `files`
  list was already right; nothing is built, the TypeScript ships raw as J53/J82
  already require. `npm pack --dry-run`: 3,060 files, 11.8 MB packed, 35 MB
  unpacked; every bin and export is inside.
- `.github/workflows/npm-publish.yml`: a `vX.Y.Z` tag (pushed by
  `release.sh --finish`) publishes by OIDC with no token, after the same
  changelog check `changelog-tag.yml` runs, a tag-equals-version check and a
  tarball check. It skips with a notice while the package does not exist yet:
  npm only trusts a publisher for a package that exists, so Jake publishes the
  first version (NP4). v0.1.14 was cut private, so v0.1.15 is the first one npm
  can take.
- Engine still installs format and wire from git; it moves to npm ranges once
  those two are on npm (NP5).
