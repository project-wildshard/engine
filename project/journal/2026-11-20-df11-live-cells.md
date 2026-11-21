# DF11 relay 7: fewer live cells (mini-df11g)

WebKit's full collection costs per live cell (relay 6). A dock heap snapshot holds 1.176M reachable cells; ablating
~185k of them in-page took a forced full from 20.6 to 17.3 ms, so the cost is roughly linear in cells.

- valibot Standard Schema props are built lazily in the client build (`vite/valibotStandard.ts`): ~18.4k schemas lose
  two cells each. Nothing in the bundle reads `~standard`.
- Collision strips stop retaining seam features (~55k objects nobody reads after the presentation builders).
- `onCellField` slots keep the prior descriptor's enumerability instead of the descriptor and hold a sole subscriber
  without a Set (~8k watched fields at the dock, three fewer cells each). Shared per-key accessors were tried and dropped:
  they put a symbol and dictionary lookup on every watched `position.x` read and write.
- The lazy `~standard` accessor moved to one shared prototype: a per-schema accessor still cost a GetterSetter cell each
  (+18k), the shared prototype costs none.
