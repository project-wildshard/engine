# DF11 relay 7: fewer live cells (mini-df11g)

WebKit's full collection costs per live cell (relay 6). A dock heap snapshot holds 1.176M reachable cells; ablating
~185k of them in-page took a forced full from 20.6 to 17.3 ms, so the cost is roughly linear in cells.

- valibot Standard Schema props are built lazily in the client build (`vite/valibotStandard.ts`): ~18.4k schemas lose
  two cells each. Nothing in the bundle reads `~standard`.
- Collision strips stop retaining seam features (~55k objects nobody reads after the presentation builders).
