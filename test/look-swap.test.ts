import { expect, test } from 'vitest';
import type { ShardRows } from '@wildshard/format/rows';
import { SpeciesService, type SpeciesLook } from '../src/client/engine/entities/species/look';
import { pageSpecies, speciesSwaps, speciesViewKinds } from '../src/client/game/shardfile/clientRecipes';
import { WirePage } from '../src/client/game/shardfile/wirePage';
import { Scope } from '../src/shared/engine/app/scope';
import type { SpeciesRow } from '../src/server/engine/ai/species';

// ONE-FORMAT CC28c (Q-CC48): a shape-shifter is two looks on one body, switched by a channel. The page draws the second
// look as a kind of its own while the row's channel is at `at` or more, and back again below it.
const DIMS = { bodyHalfLen: 0.3, bodyRadius: 0.36, bodyY: 0.62, feet: [], halfWidth: 0.36, headRadius: 0.22, legLen: 0.42 };
const ROWS = {
  species: [{ id: 'were', kind: 'bear', label: 'Werebear', aggressive: true, lockable: true, dims: DIMS, variants: [],
    body: { size: 'medium', scale: 1, look: 'were.man', channels: [{ name: 'jaw' }, { name: 'form' }], swap: { channel: 'form', look: 'were.bear' } } }],
  looks: [{ id: 'were.man', species: 'were' }, { id: 'were.bear', species: 'were' }],
} as unknown as Pick<ShardRows, 'species' | 'looks'>;

test('a body with a swap draws its second look under a kind of its own while its channel is high', () => {
  const swaps = speciesSwaps(ROWS);
  expect(swaps).toEqual([{ species: 'were', look: 'were.bear', kind: 'were.bear~swap', index: 1, at: 0.5 }]);
  // What the page's kit does (client.ts kitData): the swap look and a copy of its row under the swap kind only.
  const kinds = speciesViewKinds(ROWS), level = new Scope('level'), service = new SpeciesService(() => level), page = new WirePage();
  const looks = ROWS.looks.map(look => ({ id: look.id, species: look.species, kind: 'bear', label: look.id, rig: 'custom', rigContract: { sockets: ['body', 'head'] } }));
  for (const row of pageSpecies(ROWS.species, kinds)) service.registerRow(row as unknown as SpeciesRow, level);
  for (const look of pageSpecies(looks.filter(entry => entry.id !== 'were.bear'), kinds)) service.registerLook(look as unknown as SpeciesLook, level);
  const [swap] = swaps; if (swap === undefined) throw new Error('Missing swap');
  service.registerRow({ ...ROWS.species[0], id: 'were~swap', kind: swap.kind } as unknown as SpeciesRow, level);
  service.registerLook({ ...looks[1], kind: swap.kind } as unknown as SpeciesLook, level);
  page.declareSwaps(new Map([['bear', swap]]), level);
  expect(service.look('bear')?.id).toBe('were.man');
  expect(page.lookKind('bear', [0, 0.4, 0, 0])).toBe('bear');
  expect(page.lookKind('bear', [0, 0.5, 0, 0])).toBe('were.bear~swap');
  expect(service.look(page.lookKind('bear', [0, 1, 0, 0]))?.id).toBe('were.bear');
  expect(page.lookKind('deer', [1, 1, 1, 1]), 'a kind with no swap keeps its look').toBe('deer');
  level.dispose();
  expect(page.lookKind('bear', [0, 1, 0, 0]), 'the level gone, its swaps go with it').toBe('bear');
});
