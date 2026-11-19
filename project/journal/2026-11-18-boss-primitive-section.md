# The boss primitive comes from the boss section alone (ONE-FORMAT OF17b2)

- OF17b1 derives the server's primitive list from the product's sections. With OF34b's encounter starts on main, a
  fixture whose only boss declaration is its `combat/encounters` boss row runs `boss` in each start (placed, spawned,
  resident); its arena `bounds` add `boss.arena`; the same product without the row runs neither. No host list ships.
- Proof: `test/encounter-starts.test.ts` (OF17b2 case).
