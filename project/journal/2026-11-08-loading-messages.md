# LS1: bounded worker receipt summaries and real grid entry

The real grid entry reproduced 405 separate worker:message-receive
entries with no realm summary. That linear receipt log could consume
the collector's 4096-entry allowance independently of named boot work.
Ordinary receipts now increment a counter per realm. Each realm retains
its count, first/last receipt times and up to 32 kind names plus other.
Worker-origin packets preserve that summary when adopting their metadata.
The entry cap stays 4096. No message interval is invented as a work span.
Byte streams and actual atomic completions keep their separate units.

The outer-edge check sends 5000 actual messages from a real browser
Worker on the title page, then enters the real grid through its button.
Both Chromium and WebKit retained all 5000 receipts in two timing entries
without overflow. Their real grid boots each counted 405 ordinary worker
messages without allocating per-message entries. Realm totals, kind
totals and receipt timestamp ordering agree with the retained counters.

Chromium first-step/loader-complete was 2531/25206 ms, with 1319 entries,
1222 atomic completions and a 286 ms maximum unnamed gap. WebKit was
2627/4950 ms, with 1335 entries, 1238 completions and a 284 ms gap.
Both reached actual grid gameplay readiness and rendered real frames.
The gap calculation runs through loader-complete and excludes unresolved
intervals. The same check with a five-second delay in the real Server
world callback passed at 2040/15341 ms in Chromium and 2126/8500 ms in
WebKit, with maximum gaps of 274/268 ms. Worker-streamed bytes remained.

Types, full lint and the 1665-file side inventory pass; all 28 pinned
products build. The manual proof stays outside hooks and unit-test globs.
This is another additive commit above 2929143. It changes no UI, layout,
boot await or network behavior, and sends no diagnostics off the page.
