// FORMAT-PRUNE FP31: coins and the loot runtime (purse, Bag loot row, shop) are on only where a loot row declares the
// shard's currency (`coinsDeclared`). This holds every pinned product that ships a loot row to a declared currency, so
// retiring OF31g4's any-loot-row rule switches no live shard's loot off.
// oxlint-disable-next-line import/no-nodejs-modules -- The proof reads each pinned product's economy/loot section.
import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { builtFolder } from '../src/test/game/builtFolder';
import { declaredCurrency } from '../src/shared/game/loot/currency';

interface PinRow { readonly slug: string; readonly revision: number }
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

test('every pinned product with a loot row declares its currency (FP31)', () => {
  const pins = read<{ shards: readonly PinRow[] }>('test/pins/shardfiles.json').shards;
  const undeclared = pins.flatMap(pin => {
    const path = `${builtFolder(pin.slug)}/sections/economy/loot.json`;
    if (!existsSync(path)) return [];
    const rows = read<{ rows: { loot: readonly { readonly economy?: unknown }[] } }>(path).rows.loot;
    return rows.length > 0 && declaredCurrency(rows) === null ? [`${pin.slug} r${pin.revision}`] : [];
  });
  expect(undeclared, 'pins with a loot row and no currency would lose their purse, Bag loot row and shop').toEqual([]);
});
