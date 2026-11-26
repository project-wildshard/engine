# 2026-11-26 content reach reads only this build's graph (meta QA 11-25 row 146)

- rel86 walked every file in v0.1.96's dist/ and found 190 named paths its set lacks; guard131's check read 8504
  and found none. The gap: the page carries four older builds (MF2), and v0.1.85's graph is unmarked, so its books,
  spawn lists and boot tables ride along and name v0.1.85's own content. No v0.1.96 client asks for any of them
  (staging boot through ENTER THE MMO, Nine Dragon, Pine Hollow: 0 404s, 0 requests for the 190).
- content-reach now reads deploy-chunks.json and takes this build's own graph (its b/c/ shared code too, 279 names
  the row 131 check never read), never a carried build's. Summary: page files read, carried files left out.
