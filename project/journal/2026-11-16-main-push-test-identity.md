# main-push's tests carry their own git identity (main red, buddy-engine)

- Main ci 43965567759 (fe991ad7..2f4b9ebd), tests (1): 7 of the 8
  `.githooks/main-push.test.mjs` cases stopped with `git commit refused:
  Author identity unknown`.
- Cause: `scripts/main-push.mjs` strips every `GIT_*` variable before it
  runs git, so the identity the test passes as `GIT_AUTHOR_*` never
  reaches the commit. A Mac never noticed, because macOS's git guesses
  an identity from the user and host name. The Linux runner has no
  global identity and guesses nothing.
- Fix in the test: the fixture gets its own `HOME`, whose `.gitconfig`
  has `user.useConfigOnly` plus a name and email. Every machine is now
  the runner: with only `useConfigOnly`, the same 7 cases failed locally
  as in CI, and they pass with the identity.
- The same run's tests (2) red (`test/land.test.ts`, the quarantine
  job's `if:`) was already fixed on main by `699af2b2`.
