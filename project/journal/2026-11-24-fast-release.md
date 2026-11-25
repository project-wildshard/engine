# Fast release: engine release ci reuses main's proof (FAST-RELEASE FR6)

- A release branch whose head only stamps the version and adds notes over a cut with a code-proving main ci run now
  runs the docs lane plus the release readers instead of the whole suite (`scripts/ci-selection.mjs`). v0.1.84's
  release ci took 24 min, a rerun included, to prove nothing main had not.
- Three places assumed a release run proves code and had to learn the reuse shape: the tag push
  (`hostedReleaseProof`), the train's exact release CI check (`provesReleaseReuse`) and npm-publish's next admission
  (re-runs the selector; needs the cut, so its checkout is depth 2).
- `test/ci-release-reuse.test.ts` keeps it: the reader list must name every test reading the real version or notes,
  and every ci.yml job must follow the selector's verdict.
