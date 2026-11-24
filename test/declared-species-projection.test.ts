import { expect, test } from 'vitest';
import { speciesBehaviour } from '../src/client/game/looks/speciesBook';
import { declaredProjections } from '../src/shared/game/shardfile/declaredProjections';
import { parseActorProjectionV2 } from '@wildshard/format/actorProjectionV2';
import { liveTitanInline as programme } from './fixtures/liveNalati';

// ONE-FORMAT OF30 (Nalati): the timed guest's projection comes from its declared species row, the look book's is the fallback.
type Book = Parameters<typeof speciesBehaviour>[0];
const step = { signal: 'bossClamp', clock: 'sampleAt', every: .2, columns: [{ name: 'fullHp', id: 1, source: { kind: 'memory', key: 'capacity', default: { value: 100 } } },
  { name: 'share', id: 2, source: { kind: 'memory', key: 'share', default: { value: .3 } } }],
  operations: [{ kind: 'memory', key: 'strength', value: { kind: 'channel', name: 'hp' } }, { kind: 'memory', key: 'sampleAt', value: { kind: 'time' } }] };
type Row = Book['rows'][number];
const metadata: Row['metadata'] = { id: 'species.steppe.balbal', kind: 'balbal', label: 'Balbal', variants: [{ id: 'warrior', label: 'Warrior', weight: 1, rarity: 'common', scale: [1, 1] }] };
const book = (projection: unknown): Book => ({ rows: [{ metadata,
  ...(projection === undefined ? {} : { projection: parseActorProjectionV2(projection) }) }] });

test('a declared projection wins over the look book and drives the row', () => {
  const declared = declaredProjections([{ kind: 'balbal', projection: { program: programme.attack, step } }, { kind: 'balbal', projection: { program: programme.wind } }]);
  const rules = speciesBehaviour(book({ program: programme.fire }), declared);
  expect(rules.programs.get('balbal')).toEqual(programme.attack);
  expect(rules.rows).toEqual([{ ...metadata, phased: true }]);
});

test('with no declared projection the look book stands, as before', () => {
  const rules = speciesBehaviour(book({ program: programme.fire }), declaredProjections([{ kind: 'balbal' }]));
  expect(rules.programs.get('balbal')).toEqual(programme.fire);
  expect(rules.rows).toEqual([metadata]);
  expect(speciesBehaviour(book(undefined), declaredProjections([{ kind: 'wolf', projection: { program: programme.wind } }])).programs.get('wolf')).toEqual(programme.wind);
});
