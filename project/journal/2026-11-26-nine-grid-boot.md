# Nine boots on the grid under `wildshard dev`: its far from its product, its post once lent (opus-nine133, meta QA 11-25 row 133)

- The far loader chose its source by the page's inventory alone: a slug whose inventory lists a baked `far.json` read
  that file. The devserver client archive (`devserver-client.mjs`) keeps the inventory but drops every shard's baked
  folder, and `wildshard dev` serves the author's product, so Nine's far fetch 404'd and the boot stopped at `gap`.
  `grid/farSource.ts` now decides by what is served: a listed baked far the server answers 404 for is read from the
  product's own far rows, and the page remembers it, so `keepFarFiles` reads the product too. A 503 still fails.
- Nine's post look (`look/post.json`) composes with the lent uniform set `nine-shared`, which its world lends when its
  scenes install. On its own page the world phase runs first. On the grid the cell's region, and its post
  (`hangCellDataPost`), is resident before the feet enter; the world installs with the cell's plan only when they do.
  So the post composed first and threw `No lent uniforms nine-shared`. A post-graph look now says which set it
  borrows (`borrowsUniforms`), and the cell lays it on each loan (`whileUniformsLent`, `layCellPostWhenLent`), for as
  long as that loan and the cell last, building it again for a later loan.
- Tests: `farSource.test.ts` (served, 404, 503, unlisted) and `cellDataPost.test.ts` (the throw before the loan, the
  post laid on the loan, gone with it, laid again on a new one, nothing after the cell leaves; newer loans replace).
