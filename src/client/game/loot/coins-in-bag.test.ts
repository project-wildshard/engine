// oxlint-disable-next-line import/no-nodejs-modules -- the real stylesheet, not a copy of it
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// J473 row 8 (Jake, 2026-11-19: "coins can go into the bag"): the phone HUD has no purse chip; the Bag's gear tab shows it.
test('J473 row 8: a phone HUD drops the coin chip; the Bag keeps the purse', () => {
  const css = readFileSync('src/client/game/loot/loot.css', 'utf8'), runtime = readFileSync('src/client/game/loot/runtime.ts', 'utf8');
  expect(css).toContain('.ws-touch > .ws-loot-chip { display: none; }');
  expect(runtime).toContain('coins:purse.coins}');
});
