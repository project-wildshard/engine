# The train names the leg that dirties its clone (opus-rel86, QA 11-25 row 88 follow-up)

- v0.1.94's third cut passed local QA, prepare, release CI and the client archives, then staging go-live refused its
  upload at 08:09 UTC: "the release tree is not clean (one clean clone per channel)". The refusal is right. But the
  clone sat in the train's scratch, which is removed on exit, and nothing named the file or the leg that wrote it.
- A fresh clone at the build stayed clean through pnpm install, the staging build and a staging observer run, so the
  writer is in go-live before its upload, and a repro outside the train did not show it.
- `treeDirt` (src/scripts/release-train-proof.mjs) reads `git status --porcelain` of a train clone. The train now holds
  after local QA, after the staging build and when go-live fails if its clone is dirty, naming the leg and up to 20
  status lines; `writeHold` keeps that in hold.txt. test/release-train.test.ts dirties a clone and reads the reason.
- The train loads from the canonical checkout, so the rerun after this lands names the writer without a re-cut.
