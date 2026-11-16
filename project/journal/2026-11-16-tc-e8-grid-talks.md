# TC-E8: data cell talks in the grid (opus-brassgun10)

- Staging serial 92 probe (WebKit phone, `/slug/brasscap-mesa`): standing on Sheriff Brass and the wanted poster showed no
  prompt and E did nothing; the server had already said each talk's node (`dialogue:brasscap.sheriff` = 1). The client only
  installs `targets.talks` in the one-shard shardfile client; a grid copy offered only `targets.interactions` (copyPrompts).
  Mossgate's Lamplighter and hermit are talks too, so its whole quest chain was stuck on staging.
- Fix: `grid/dataCellTalks.ts` installs the copy's talks into its prompts while the feet are in the cell (beside the data kit),
  reading the cell's owned lines and pressing answers on its wire; `talkStandIns` draws figure-less talkers in the cell's
  render root at tile admission. Test: `grid/data-cell-talks.test.ts`.

- TC-M1 test (`test/template-strikes-hurt.test.ts`): the pinned Template cell, player beside a grey blob, the Greyback
  and a mossling; each strike lowers health within 20 s; a control with every body down keeps full health.
- TC-B3: the same test on the pinned Brasscap cell (blender-template): camp bandit, rusher (pack mates up) and dust
  wyrmling each hurt. Found: camp 2 marksmen spawn at y 6 but drop to the canyon floor in the server cell and never fire.
