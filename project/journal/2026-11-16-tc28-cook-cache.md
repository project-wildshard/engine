# Cook reuse has independent witnesses

> Written by: Codex

> **State:** built, 2026-11-16; TEST-COVERAGE TC28, engine milestone
> shared with TC22 on plan/tc22-nightly-release (J334/J336).

The quick proof changes each actual cook input, adds a newly imported
input and changes it, and changes the format identity. Every edit moves
cookRevision. It copies only owned source into a private fixture.

A counting child double passes through the real bounded worker and
folder store. A fresh worker seeing an existing index launches no child
and downloads nothing. Two revisions retain separate immutable loose
headers and server folders. GC interleaved before a new index cannot
delete a reused aged part that the worker refreshed. No real cook runs
locally; all three quick cases take about two seconds.

The hosted-only proof uses the installed format's complete blender-template product and
the production cook job with its actual simulation prover. Unchanged encoder-cache inode, timestamp and
body identities show warm reuse; an independent cold comparison checks
the same actual part bodies. Every product key/body and server file must agree. A nightly
report-only job retains the receipt; cook_cache_only dispatches have their
own concurrency group and cannot qualify a full night or release.

These are new observers with their own real week before explicit blocking
admission. No cache is enabled, no source interface changes, no local
cook, and no staging/release runs on the mini. The TC22 waiter was stopped
before adding TC28 so the same plan lands once after both hosted proofs.

J206 found the renderer and actual loader missing from cookRevision. The
recipe now binds rendererRevision plus bake-loader/format-hook bytes
(schema2); a renderer-only edit and both loaders invalidate it. A small
real renderer fixture keeps the exhaustive import walk cheap. Hosted
proof now launches the unchanged scripts/cook-job.mjs, rejects retries,
compares the complete index except seconds and records elapsed time/RSS.
It also verifies a fresh complete3case quick receipt at the same SHA and
recipe. Requiring proved was declined: J370 explicitly keeps unmeasured
legal, and byte-cache correctness does not qualify gameplay traversal.

After corrections the complete3case quick proof passes2.654s, focused
TypeScript/typed lint/actionlint pass, existing11nightly and4Vitest
selector/tag cases pass. Hosted-only guard refuses a local invocation
before loading cook modules. Real cold/reused/cold runs still await CI.

Final J206 Opus review CLEAR, no MUST/SHOULD. Its optional empty-import
note exposed another real edge: import {} executes a module, so the
recipe now follows it and a mutation test covers it. Current producer
closure reads no installed boot tables; no new cache is enabled here.
