# 2026-11-14: the kit's cleanup pieces reach engine (REPO-DISK DK8)

- Engine was the last kit repo without repo-kit's scratch pieces. `agent-sync --from ../repo-kit` stamped the
  SessionEnd hook (`.agents/hooks/scratch-end.mjs`, DK4: removes this session's own `tmp/<task>/` folders on the way
  out, unless `.keep` or busy), the session brief's `./tmp` size line (DK7, with `lib/tmp-measure.sh`), and the kit's
  newer `prepare-to-exit`, `write-plan` and `codebase-design` skill text. `scripts/scratch-dir.mjs` (DK3) and
  `scripts/scratch-sweep.mjs` (DK6, a dry run unless `--live`) are copied byte for byte.
- Lint and `scripts/tsconfig.json` skip the two kit scripts like `agent-sync.mjs`: they are kit bytes, checked by
  repo-kit's `cleanup-coverage` test, not engine code.
- Kept engine's own `codebase-design/DEEPENING.md` line ("R2, Neon, Cloudflare"): the sync would have reverted it to
  the kit's "Vercel", which is not this change's business.
