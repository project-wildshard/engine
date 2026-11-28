# 2026-11-28: the first hosted memory-footprint run after the walk fix, recorded

- Meta QA 11-26 row 85, the follow-up of row 81 (engine@f324b78c, the culler's sphere copy and the fold's argument array).
  The first memory-footprint run on main at or after f324b78c is run 46125293278, at f324b78c itself, green.
- Hosted walk rate (`walk/nine-dragon-stack/rate`): 7.44 MB/s, content key nine-dragon-stack@13. The MacBook read was 14.54
  MB/s [S]; the hosted judge reads lower, as row 81's line did. Under 16 MB/s, so no fix row.
- `record --run` writes every measure the artifact carries: 52 keys. All 51 that changed carry a new content key since their
  last record (the first BC11 run, f31a7d3f58: pine-hollow@5 to @19, nine-dragon-stack@3 to @13 and so on), so J444 lets the
  content re-record them. The why names the run, the moved content and the grid-world walk.
