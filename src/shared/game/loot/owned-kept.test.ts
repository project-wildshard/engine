// ONE-FORMAT OF31f2 (Q37): a shard's kept rows say what a player keeps; an old save keeps every item it holds today.
import { expect, test } from 'vitest';
import { keptItems, Owned, type KeptRow } from './Owned';

/** Every id a player could own before OF31f2: Driftwood's 13 and Pine's two guns, three worn looks among them. */
const OLD_SAVE = {
  owned: ['whetstone-1', 'whetstone-2', 'heart-1', 'heart-2', 'sea-chart', 'cape', 'captain-hat', 'charm-1', 'charm-2', 'charm-3',
    'bear-claw', 'boar-tusk', 'iron-sword', 'warden-longbow', 'lever-rifle'],
  worn: ['cape', 'captain-hat'],
};
/** Driftwood's kept rows as its items section declares them (r9, OF31f3), Pine's (r11, OF31f4). */
const DRIFTWOOD: readonly KeptRow[] = [
  { id: 'whetstone-1', kind: 'upgrade', label: 'Whetstone I', gauge: { name: 'sharpen', level: 1 } },
  { id: 'whetstone-2', kind: 'upgrade', label: 'Whetstone II', gauge: { name: 'sharpen', level: 2 } },
  { id: 'heart-1', kind: 'upgrade', label: 'Sturdy heart I', gauge: { name: 'hearts', level: 1 } },
  { id: 'heart-2', kind: 'upgrade', label: 'Sturdy heart II', gauge: { name: 'hearts', level: 2 } },
  { id: 'sea-chart', kind: 'upgrade', label: 'Sea chart' },
  { id: 'cape', kind: 'cosmetic', label: 'Sailcloth cape' },
  { id: 'captain-hat', kind: 'cosmetic', label: "Captain's hat" },
  { id: 'charm-1', kind: 'charm', label: 'Sea glass charm I', gauge: { name: 'charms', level: 1 } },
  { id: 'charm-2', kind: 'charm', label: 'Sea glass charm II', gauge: { name: 'charms', level: 2 } },
  { id: 'charm-3', kind: 'charm', label: 'Sea glass charm III', gauge: { name: 'charms', level: 3 } },
  { id: 'bear-claw', kind: 'trophy', label: 'Bear claw' },
  { id: 'boar-tusk', kind: 'trophy', label: 'Boar tusk' },
  { id: 'iron-sword', kind: 'gear', label: 'Iron sword' },
];
const PINE: readonly KeptRow[] = [{ id: 'warden-longbow', kind: 'gear', label: "The Warden's Longbow" }, { id: 'lever-rifle', kind: 'gear', label: 'Lever-action' }];
const sorted = (ids: readonly string[] | undefined): string[] => [...(ids ?? [])].sort();

function slot(saved: unknown): { read: () => never; write: (value: { owned: string[]; worn: string[] }) => boolean; written: { owned: string[]; worn: string[] }[] } {
  const written: { owned: string[]; worn: string[] }[] = [];
  return { read: () => structuredClone(saved) as never, write: (value) => { written.push(structuredClone(value)); return true; }, written };
}

test('OF31f5: a shard that declares no kept rows keeps nothing, and its save still holds every id', () => {
  const save = slot(OLD_SAVE), owned = new Owned('old-shard', save, keptItems({ version: 1 }));
  expect(owned.all).toEqual([]);
  expect([owned.sharpen, owned.hearts, owned.charms]).toEqual([0, 0, 0]);
  expect(() => owned.grant('whetstone-1')).toThrow(/Unknown owned identity/u);
  expect(owned.kept.ids).toEqual([]);
});

test('declared kept rows read the same old save and write every item back, the ones they do not name included', () => {
  for (const rows of [DRIFTWOOD, PINE]) {
    const save = slot(OLD_SAVE), owned = new Owned('shard', save, keptItems({ kept: rows })), first = rows[0]?.id ?? '';
    expect(sorted(owned.all)).toEqual(sorted(rows.map(row => row.id)));
    expect(owned.grant(first)).toBe(false); // already owned: nothing written
    owned.revoke(first);
    owned.grant(first);
    const last = save.written.at(-1);
    expect(sorted(last?.owned)).toEqual(sorted(OLD_SAVE.owned));
    expect(sorted(last?.worn)).toEqual(sorted(OLD_SAVE.worn));
  }
});

test('Driftwood\'s declared rows fill the Bag gauges and wear its looks as the table did', () => {
  const owned = new Owned('driftwood-isle', slot(OLD_SAVE), keptItems({ kept: DRIFTWOOD }));
  expect([owned.sharpen, owned.hearts, owned.charms]).toEqual([2, 2, 3]);
  expect(owned.worn('cape') && owned.worn('captain-hat')).toBe(true);
  expect(owned.kept.label('captain-hat')).toBe("Captain's hat");
});

test('a shard\'s own kept rows name items the old table never had, and refuse what they do not name', () => {
  const owned = new Owned('new-shard', slot({ owned: [], worn: [] }), keptItems({ kept: [{ id: 'glass-crown', kind: 'cosmetic', label: 'Glass crown' }] }));
  expect(owned.grant('glass-crown')).toBe(true);
  expect(owned.wear('glass-crown')).toBe(true);
  expect(() => owned.grant('whetstone-1')).toThrow(/Unknown owned identity/u);
  expect(owned.has('whetstone-1')).toBe(false);
});
