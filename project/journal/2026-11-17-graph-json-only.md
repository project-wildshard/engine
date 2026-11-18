# 2026-11-17 — the session keeps only graph-sized JSON (ENGINE-MEMORY EM24)

> Written by: Claude (lane mini-em4)

EM24 asked that the product wire cache go once its files are decoded. Most of that was already true: D227 releases
`ClientAssets`' admitted map at control (`client.ts` `whenControl` → `releaseAll`), and a later read verifies from the content
cache (`readReleased`). What was left at control, read with the ledger after two forced collections (phone tier, Low,
headless Chromium on the mini), was **Pine 6.0 MB and Nine 11.4 MB** of `product:<slug>` bytes. A heap snapshot named the
holder: `clientMaterials` copies every JSON file into `graphFiles` for lazy graph compiles, and keeps it for the session.
That map held Pine's 3.2 MB forest ground layout, its 0.9 MB cave interior and the placement pages, none of which a
graph compile reads.

A graph file is at most `GRAPH_ADMISSION_LIMITS.bytes` (96,000): admission refuses a larger one and `graphFileJson` throws
for it. So `graphFileCandidate` (`kind === 'json'` and within that cap) is an exact filter, not a guess, and the grid's input
leases (`grid/folders.ts`) keep the same subset. At control after the change: **Pine 1.07 MB, Nine 4.72 MB** [L] (two
alternating rounds each, identical); `ram:array-buffer` Pine 66.7 → 61.8 MB, Nine 43.9 → 37.2 MB. The offline T1 e2e
(`online.spec.ts`, browser offline) passes on the changed build, and a unit test rereads a released file from the cache
with the network off.
