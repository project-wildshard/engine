# Split the cook worker file by its real cooks

> Written by: Claude (opus-flaky)

`test/cook-worker.test.ts` is quarantined (FL10, J200 deadline 2026-11-12
12:04:31Z). Every assertion passes, but the file runs over the 60 s CI file
budget on slower hosted runners: its 23 cases carried two cold cooks of the
real Sunscar Dunes product in one file. Hosted case clocks from four
quarantine artifacts on 2026-11-10: the real cook 21.5-35.8 s, the HTTP notice
4.3-7.1 s, the pack budget 4.2-6.9 s, everything else under 13 s together;
whole file 38.9-66.9 s.

The cases now live in three files, each with the original suite setup
(`test/fixtures/cookWorkerHarness.ts`: real tarball, fixed child entry,
fresh scratch) and no dependency on another file's store or encoder cache:

- `cook-worker.test.ts`: the cold real cook, its b2 recook and the garbage
  collection that needs both indexes, plus the decoded download cap.
- `cook-worker-publish.test.ts`: the HTTP notice's cold real cook, then the
  pack budget on the same warm cache, the order the original file ran them in.
- `cook-worker-limits.test.ts`: the ten hostile archives, the failed proof,
  the other-slug notice, the five job limits and the R2 store.

No case, assertion, limit or timeout changed; all 23 still run, each once.
The two new files get native groups of their own (serial, no neighbour, as
the original file had), Ring 2 placement, the Dunes product and the cook CPU
grant under local admission. The quarantined file keeps its name, so it
still has to earn ten clean hosted runs; the moved cases now block at once.

## One-shot review

J206 Codex review of 455bbec: one MUST, no SHOULD. `cook-admission-proof.mjs
--worker` ran only the quarantined file and still expected 23 passes; it now
runs all three files and keeps the 23-case and four-slot assertions
(passes locally: 23 cases, four slots). All 23 cases, limits, timeouts and
the GC expectation (stray part plus b2's index) were confirmed unchanged.
