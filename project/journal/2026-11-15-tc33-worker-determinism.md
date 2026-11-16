# Compare real worker simulation engines

State: TC33 EG26 implementation checkpoint, 2026-11-15.

The existing platform digest does not exercise JavaScriptCore. A separate
Ring 2 report now serves immutable pinned server inputs and runs one real
48-tick input tape through openCellWorld in Node and a dedicated browser
worker. Both use the production reader and its ordinary integrity checks;
no shard source, new cook, renderer, rounding or internal-field golden.
Each tick hashes the public durable save. The same comparator must refuse
a genuinely reversed movement tape. Browser, server and build output are
retired on success and refusal; the report is retained by the workflow.

Chromium is a development control only. WebKit is the default and required
hosted witness. This mini times out launching WebKit even with an empty
page, so Linux WebKit runs separately in the scheduled/manual report job.
The existing TC29, fuzz and eight-platform receipts remain valid history;
TC33 is not complete until the new JavaScriptCore witness passes.

The comparison uses the full-check admission branch on both sides, whole
solids and a pageless fresh world. It covers neither near-solid streaming
nor progress seeded from a prior page. TC33 needs the hosted artifact to
say WebKit, completeRing/ok true, dirty false, eight products and a real
browser version/user agent; the Chromium control cannot close it.
