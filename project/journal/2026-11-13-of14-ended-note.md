# OF14: the title names the shard that ended

- OFFLINE OF14 (opus-of14). Signal Dunes' offline failure dropped to a
  title saying "Infinite Wildshard ended unexpectedly last time". The
  grid's recovery guard (10 minutes after a recovery resume) reports a
  loop for any unexpected end, a one-shard page's included, and the
  loop's line won over QB6's shard name. `endedNote()` in
  `mainMenu.ts` now lets the name win; `title-ended-note.test.ts`
  was red first.
- Not changed: the loop itself still trips on a one-shard crash (the
  title opens on Shard select). Passing `unexpected` only for grid
  ends would also stop catching a grid page that dies before it
  records its mode (`mode: ''`), so that is left alone.
