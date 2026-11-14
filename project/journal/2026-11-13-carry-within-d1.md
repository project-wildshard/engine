# Preview stopped deploying: the carry fills the page (buddy-engine)

- Preview served `1b2f1ac8` from 01:55 UTC on. Every preview build since
  PAGE-SIZE's land (`1fd18fb0`, PZ6: preview reads its content from the
  CDN) failed the D1 gate: 1,300 files and 178.4 MB on the page, against
  1,000 and 100 MB. This build's own page was 60.6 MB in 330 files; the
  rest was the four kept builds.
- Those builds predate the split, so their graphs name their content and
  the carry keeps it on the page (PZ5: their tabs read it there). Each
  is about 101.8 MB, over D1 alone. They would age out after four new
  builds, but the gate refused every new build: a deadlock.
- `carryPreviousDeploy` takes a `budget`: D1's limits less this build's
  own page (`carryBudget` in the pipeline). Newest first, a kept build
  that would take the page past it is dropped whole with a warning, as a
  pruned build is; chunk recovery moves its tabs on. Code-only kept
  builds (PZ5's mark) are a few MB and carry as before.
- Against preview's live `deploy-chunks.json` all four drop, so the next
  preview build passes. Staging and production meet the same on their
  first `--content` release (PZ8): open tabs reload once.
- Test: `test/previous-deploy.test.ts` (bytes and files budgets, newest
  dropped, older code-only build kept, room carries all).
