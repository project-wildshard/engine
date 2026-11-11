# OVERNIGHT 6e: spawn manifests keep their names across code changes

Plan: meta `docs/plans/multi-repo/DOWNLOAD-THEN-C.md`, row DL26 (OVERNIGHT
item 6e). opus-ld6b's deploy probe saw every engine build re-ship all 231
`assets/spawn` JSON files with no content change.

Cause: the parts were already stable (two builds of one tree, and a leaf
code change, keep all 155 parts and 105 server parts byte-identical). The
231 shard manifests were not. Each lists the build's code chunks
(`/b/c/*.js`, `bank.common` and friends) by their content names, and each
manifest is named by the sha256 of its whole text
(`src/cook/game/entryTotals.ts`, the `written.push` loop). LD6b made a leaf
change rename only its own chunk, but every manifest lists that chunk, so
every manifest got a new name: 13.26 MB of JSON per deploy, and a returning
player's shard manifest (~20-34 kB brotli) again.

Fix: `writeSpawnManifestFiles` (`spawnParts.ts`) writes each manifest as
its content (no `.js/.mjs/.css` rows, never part members) and a code list
`assets/spawn/code/<sha16>.json` holding those rows and their places. The
address in the book carries `code: {url, bytes}`; `joinSpawnManifest`
rebuilds exactly the old manifest (same rows, order, member indices,
totals), so the reader and every gate see what they saw before. The page
reads the two files together; the list from the document's origin, as it
is the build's own. `readBuiltSpawnManifest` (`engineHalf.ts`) does the
same on disk.

Measured (LD6 method, one-line change in `engineStrings.ts`, real
`build:game`): manifest bytes at the same URL 0 % (0 of 231) before, 92.8 %
after (224 of 279 JSON files; what moves is 48 code lists, 433 kB, plus the
per-build index and engine-half files). All spawn bytes: 96.8 % -> 99.8 %.
Two builds of one tree: 100 % of parts and manifests, as before.

Guard: `test/spawn-stable-names.test.ts`. `test/entry-totals.test.ts`
(lift-pending) reads the joined manifest now.

Codex J206 review (one-shot, read-only): two MUSTs fixed. `record-fence-reads.mjs`
declared `code` twice (the script would not parse). The reader waited on
`Promise.allSettled`, so a failed code list hung behind a stalled manifest
read; it now fails at once (the job's catch aborts the sibling) and cancels
any copy no store kept. Its SHOULD (cancel clones on a parse or store
failure) is in the same change. Real boots: `loading-card-proof.mjs` single
and `--grid` pass on Chromium and WebKit with 0 faults.

Timings: the pre-push asked for committed clocks for the new test file;
`push-test-timings.mjs record` wrote them (full and Ring 1).
