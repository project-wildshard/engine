// meta QA-FEEDBACK-2026-11-20-mini row 5 (mini-dw-fix, IPHONE13-DRIFTWOOD DW9): mid-quest on Driftwood's grid cell (26 flags,
// coins, doubloons) its Settings card read "QUESTS 0 DONE · EMPTY" and the sheet "FLAGS NONE": a page on a server keeps its
// progress in the server's copy, and the cards read only the page's. A card shows the server's copy when it holds anything.
import { expect, test } from 'vitest';
import * as v from 'valibot';
import { installCatalogueFixture } from './fixtures/bootSetup';
import { cardLines, mergedSummary, sheetRows } from '../src/client/game/savesSettings';
import { SaveStore, type SaveStorage } from '../src/shared/engine/saves/store';
import { instanceSave } from '../src/shared/game/instanceSaves';
import { previewNewGame } from '../src/shared/game/newGame';

await installCatalogueFixture();

const memory = (): SaveStorage => {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, key: index => [...data.keys()][index] ?? null, getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
};
const store = (): SaveStore => { const storage = memory(); return new SaveStore({ local: storage, session: storage }); };
const flagsKey = { key: 'flags', scope: 'shard' as const, version: 1, schema: v.array(v.string()), initial: (): string[] => [] };
const purseKey = { key: 'purse', scope: 'shard' as const, version: 1, schema: v.number(), initial: (): number => 0 };
const driftwood = { id: 'driftwood-isle', shard: 'driftwood-isle' };

test('a grid card shows the server\'s copy of the save when the page\'s own is empty', () => {
  const page = store(), server = store();
  instanceSave(server, flagsKey, driftwood).write(['quest:driftwood.started', 'seen:pier', 'shard:wreck']);
  instanceSave(server, purseKey, driftwood).write(13);
  const merged = mergedSummary(previewNewGame(page, driftwood), previewNewGame(server, driftwood));
  if (merged === null) throw new Error('No summary');
  expect(merged.before.flags).toEqual(['quest:driftwood.started', 'seen:pier', 'shard:wreck']);
  expect(cardLines(merged)[1]).toBe('13 COINS');
  expect(sheetRows(merged).find(row => row.label === 'FLAGS')?.value).toBe('RESET');
  // the page's copy alone stays what it was: empty, flags none
  const pageOnly = mergedSummary(previewNewGame(page, driftwood), undefined);
  expect(pageOnly?.before.flags).toEqual([]);
  expect(sheetRows(pageOnly ?? merged).find(row => row.label === 'FLAGS')?.value).toBe('NONE');
});

test('an empty server copy leaves the page\'s own save on the card', () => {
  const page = store(), server = store();
  instanceSave(page, flagsKey, driftwood).write(['seen:pier']);
  expect(mergedSummary(previewNewGame(page, driftwood), previewNewGame(server, driftwood))?.before.flags).toEqual(['seen:pier']);
});
