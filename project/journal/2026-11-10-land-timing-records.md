# land: test clocks alone never force a hosted rerun

The coordinator, 2026-11-10: land's rebase rule treated the timing records
(`test/durations*.json`, `durations-source.json`, the observations log) as a
harness change, so almost every rebase reran hosted CI on the branch
(opus-ld6b's `fa35c8b5` did). Clocks decide how test files are packed into
shards, never what a test proves.

Now a rebase whose only overlap with main is timing records and stamps is
`carried`: the split pre-push runs on the rebased tree and land watches
main's hosted run. `pushSelection` takes `timingRecords` (land's rule only)
and counts the records as data; the pre-push and CI selection are
unchanged, so a push of new clocks still runs the full suite there. A real
harness or config change beside the clocks still reruns hosted CI. Both
sides have a real-git test in `test/land.test.ts`.
