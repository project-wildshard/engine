# Engine takes the script-sides format (SERVER-PARITY SS12)

> Written by: Claude (opus-ss12), 2026-11-12

Engine's `@wildshard/format` moves from `8fcfa77` (Brasscap rev 2) to shardfile main `0786a04`. That brings SS2's
side table, SS7's v1 `side: 'sim' | 'view'` and the Pine grandfather. Brasscap's corpus is the same bytes, so its pin
stays.

- `DecisionScript.side` stays `'sim'`. The `sim/scripts` and spawn rows are narrowed by `simDecisionRow`, which names
  the row and throws on a `view` row. Format admission already refuses one there.
- The server drops `view` rows from `actors/return-scripts` (`serverReturnRows`) before it prepares or lends return
  modules. Only the page runs a view row. No shipped product has one yet.
- `pins.ts install` prints the validator's warnings. Pine is admitted with its grandfather line until SS11.

Left for shardfile (review): format does not refuse a server-run native program that points at a `view` return row.
The server would fail loudly at install (`Missing admitted raw return module loan`); admission should catch it first.
