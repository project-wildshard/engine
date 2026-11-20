import { expect, test } from 'vitest';
import { installQuestCatalogue } from './clientCatalogue';
import { registerItemRow } from '../../../shared/game/bag/itemCatalog';

test('ONE-FORMAT OF23a: a catalogue item the kit already registered is not registered twice', () => {
  const kitItem = { id: 'of23a-kit-meat', label: 'Meat', icon: 'meat' as const, travels: false }, own = { id: 'of23a-honey', label: 'Honey', icon: 'meat' as const, travels: false };
  const release = registerItemRow(kitItem);
  try {
    const items: unknown[] = [], feats: unknown[] = [];
    const product = { section: (name: string) => name === 'combat/items' ? { items: { catalogue: [kitItem, own] } } : { quests: { achievements: [] } } };
    installQuestCatalogue({ product, rows: { item: (rows: unknown) => { items.push(rows); }, feat: (rows: unknown) => { feats.push(rows); } } } as never);
    expect(items).toEqual([[own]]);
    expect(feats).toEqual([[]]);
  } finally { release(); }
});
