# Cook release follow (codex-ms)

- MS2.4a: cook credentials stay in `cook.env`; a verified staging release now
  writes the root-only tag/build state. The five-minute timer calls the
  constrained cook-only rebuild path, which refuses a forged or mismatched tag
  before it can change the checkout.
- The release state lives under `/etc/wildshard`, not the cook-owned home, and
  checkout verification requires the signed tag to resolve to the exact signed
  engine commit. The existing MS2.4b read-only checkout rules remain in force.
- Focused Vitest startup is currently stopped by CI21's known deadline gate;
  shell/Node syntax and direct positive/forged/mismatched-release checks pass.

- MS2.4b: the cook now installs through `/var/lib/wildshard-pnpm-store`, a
  root-owned group-readable global virtual store. Its install enables pnpm's
  global store explicitly and proves the resulting layout before the sandboxed
  worker can start.

- Review fixes: the timer no longer installs its own script onto itself; a tag
  is proved to resolve to the signed build before the checkout or marker can
  change; and `--check` verifies the release without writing its state file.

- Rebased onto v0.1.21's AUTO-RELEASE work: `cook.settings` now overrides the
  signed follow state, which overrides legacy `cook.env` values. The service
  reads all three in that order and its restart hash covers them. Focused
  `test/vps-rebuild.test.ts` passes after the composition.

- The first queued land's full pre-push found the release lint's strict
  missing-index spelling. The parser now uses `index === -1`; both game and
  kit lint are rerun before re-queuing.

- AUTO-RELEASE's `wildshard-config cook` is intentionally retained: it is the
  explicit signed-release move and now overrides the follow state. There is no
  `release-cook.mjs`; `cook-follow.mjs` remains the distinct verifier for the
  staging signed catalogue. Its parameters and exported test contract are now
  declared for the VPS typecheck.
