# script-paths judges git's tracked tree here too

Meta QA 11-25 row 145. This clone (engine-quickfix) holds an untracked `scripts/`
(look-loop, trailer, `__pycache__`), and the moved-folder check asked the disk,
so a moved `scripts/` path passed here and the push gate's clean copy refused it
(opus-rel86's `test/vps-lean-bridge.test.ts`, twice). The fix and its test are
repo-kit 0d36ef9 (`files/.githooks/script-paths.mjs`, `trackedExists`); this is
the same hunk on engine's stamped copy, without restamping the kit's newer
checks. With it engine still has 0 findings.
