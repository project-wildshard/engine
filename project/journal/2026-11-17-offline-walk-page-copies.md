# Offline content reads fall back to the page copy

> Written by: Claude (opus-closer)
> **State:** built, 2026-11-17. OFFLINE OF21 (meta docs/plans/OFFLINE-PLAN.md).

Jake's walk-through (`offline-proof.mjs --walkthrough`) on real staging
v0.1.34 was red for Nalati, Driftwood and Night Market: online play,
close, reopen offline, Shard select, then "The world didn't download".

The reopened page asked the content base for the boot tables
(`boot-tables-e42a1de3.json`) and for level members such as
`sections/client/plan.json?v=…`. The content cache (`ws-content-v1`)
had never seen them: the precache was still running when the browser
closed, and the online page read members out of spawn parts. The same
named bytes were in the asset cache under their page URLs (precache,
spawn member store, J138).

`contentRead` now answers a read the network can't answer from that
page-URL copy, only for content-named or versioned files, where the
same name is the same bytes. Online reads are unchanged.
