# SR4: a crash resumes where the server's save stands, not a stale page place

The cause was in `2026-11-09-grid-crash-place-split.md`: Chromium can lose a
killed page's newest localStorage writes, so after a real process kill the
page's `grid.last-played` still said the road beside Driftwood while the
server's IndexedDB site said Ember Forge (cell 16). `restoreLast` trusted the
page's copy, the page booted on the road and the server in Ember, and the
loader stalled at "server" in four of five Chromium runs.

Now, after an unexpected grid end only, the page entry reads the grid
session's two site documents from the server's database (two gets, bounded by
2 s) and `restoreLast` resumes the page's place only when it stands where the
server's newest bootable site does: the same cell, or the road for a road
site. A stale place resumes nothing, so the page lands on the title, and its
GRID tap resumes the server's continuation, as J190 has a tap and a crash
recovery do. A current place still auto-resumes, and a failed or missing read
keeps the old behaviour.

Review (J206, Codex) found the page's read looser than the server's: the
`SITE` schema lives server-side, and a newest document the server refuses
could let a stale place through. So the rule is now that every site
document the page can read must name the place's site; a disagreement
lands on the title, and its tap resumes the server.

A second review found the page's reader still dropped documents the
server accepts (a tick past 2^53). The reader now judges nothing: every
present site document is a row, and one it can't read agrees with no
place. A contract test writes the documents with the server's own
`SITE` and `SaveStore`.
