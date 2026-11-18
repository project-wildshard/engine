# 2026-11-17 — worker messages transfer, never clone (ENGINE-MEMORY EM25)

> Written by: Claude (lane mini-em4)

EM25 asked for a test that wraps `postMessage` during the phone boot and fails on a cloned buffer of 64 KB or more.
`scripts/memory/cloneRecorder.mjs` is that wrapper: on the page (an init script) it wraps `Worker.prototype.postMessage`
and `MessagePort.prototype.postMessage`, and inside each dedicated worker (installed as Playwright reports the worker)
`DedicatedWorkerGlobalScope.prototype.postMessage`. It sums the ArrayBuffers a message holds outside its transfer list;
SharedArrayBuffers are not copied and do not count. T1's phone world installs it, and `phone.spec.ts` asserts no row.

Discovery on the trimmed measurement build (phone tier, Low, headless Chromium on the mini): Nine 881 messages, Pine 1,937,
**0 cloned bytes** either way. The ring-1 T1 boot found one path: the grid road's tile capture
(`roadTileCaptureWorker.ts`) posted each source's arrays by structured clone, **20.86 MB in four messages, the largest
20.38 MB**. A clone serializes a copy beside the one the worker receives, so a 20 MB source held three copies at once.
`jobMessage` now sends one tight copy of each array and transfers it: two copies, the page's own (its mesh uploads it)
and the worker's. The job keeps the page's arrays for a refused retry, so the job itself no longer copies a view tight;
the tight copy moved to the message, and `road-tile-capture-job.test.ts`'s tight-copy test now reads the message.

Workers that reply before the recorder lands in them are missed (nothing is paused: a paused worker held the T1 boot).
