# Production proves its page and content set agree, before and after the alias (opus-guard131, QA 11-25 row 131)

- v0.1.92 went live naming 357 content paths its set never held (rows 121, 123). Row 121 stopped the cause at the cut;
  this row makes promotion itself prove the result, so a different cause can't ship the same 404s.
- `page-release/content-reach.mjs` reads the page (index.html, sw.js, the code index.html loads), the boot tables, the
  three spawn books and the lists they name, and checks each content path: in the set's `content.json`, 200 with play's
  CORS, and the same bytes as the set staging QA played (spawn books and lists are channel-bound, so skipped).
- Production go-live runs it on the local build just before the alias moves and on the live page after it; a miss
  refuses. After the move the alias stays, so the fix is the set, forward. `ALLOW_CONTENT_GAPS=1` is the J381 hatch.
- The staging verdict now names its `contentBase`. Sets differ by channel by design (carried builds, channel code
  lists): v0.1.92 staging `d21a64ad` held 9,950 files, production `2ba30cfd` 9,827.
- Live read on prod, 05:27 Cancún, static only (J205): 8,504 named paths, all 200 with CORS after row 123's restore,
  0 differ from staging's set, and 90 still missing from the index (the restore wrote files, not the index): the check
  fails prod today, as it should.
