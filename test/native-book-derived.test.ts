import { expect, test } from 'vitest';
import { readSpeciesPrograms } from '@wildshard/format/speciesPrograms';
import { HullLookBook } from '../src/client/game/looks/speciesBook';
import { SpeciesService } from '../src/client/engine/entities/species/look';
import { hasSpecies } from '../src/shared/engine/entities/species/registry';
import { Scope } from '../src/shared/engine/app/scope';
import { Rng } from '@wildshard/format/seededRng';
import type { SpeciesRow } from '../src/server/engine/ai/species';
import type { EngineRows } from '@wildshard/engine/level/context';
import fixture from './fixtures/native-book-derived.json';

const kind = 'antler-king';
function source() {
  const data = readSpeciesPrograms(structuredClone(fixture.program));
  const row = data.program?.species[0]; if (row === undefined) throw new Error('Missing real derived row');
  return { data, row, book: structuredClone(fixture.book) };
}
test('two real derived books keep their definitions and driven metadata in their own level scopes', () => {
  const first = source(), second = source(), page = new Scope('page'), one = page.child('one'), two = page.child('two');
  let active = one;
  const service = new SpeciesService(() => active);
  const target = (scope: Scope): Pick<EngineRows, 'species' | 'speciesLook'> => ({
    species: values => { for (const row of 'kind' in values ? [values] : values) service.registerRow(row, scope); },
    speciesLook: values => { for (const row of 'kind' in values ? [values] : values) service.registerLook(row, scope); },
  });
  const before = JSON.stringify(first);
  expect(hasSpecies(kind)).toBe(false);
  try {
    const a = new HullLookBook(first.book); a.install(target(one), first.data.page, first.data.program?.species);
    const b = new HullLookBook(second.book); b.install(target(two), second.data.page, [{ ...second.row, label: 'Other book' }]);
    expect(hasSpecies(kind)).toBe(false);
    const own = service.get(kind); expect(own?.label).toBe(first.row.label); expect(own?.phased).toBe(true);
    expect(own?.rig).toBe('custom'); expect(typeof own?.animate).toBe('function');
    const variant = own?.variants[0]; if (own === undefined || variant === undefined) throw new Error('Missing scoped derived definition');
    const body = own.build(variant, new Rng(42));
    expect(body.dims).toEqual(first.book.derived[kind].rig.dims);
    expect(body.bones).toEqual(first.book.derived[kind].rig.bones);
    active = two; expect(service.get(kind)?.label).toBe('Other book');
    active = one; expect(service.get(kind)).toBe(own);
    one.dispose(); expect(service.get(kind)).toBeUndefined();
    active = two; expect(service.get(kind)?.label).toBe('Other book');
    two.dispose(); expect(service.get(kind)).toBeUndefined(); expect(hasSpecies(kind)).toBe(false);
    expect(JSON.stringify(first)).toBe(before);
  } finally { page.dispose(); }
});
test('an explicit page identity keeps its fields and order when a driven row shares the identity', () => {
  const f = source(), pageRow = { ...f.row, label: 'Page owner', phased: false }, rows: SpeciesRow[][] = [];
  const before = JSON.stringify(f), book = new HullLookBook(f.book);
  book.install({ species: values => { rows.push('kind' in values ? [values] : [...values]); }, speciesLook: () => undefined }, [pageRow], [f.row]);
  expect(rows).toHaveLength(1); expect(rows[0]).toHaveLength(1);
  expect(rows[0]?.[0]).toBe(pageRow); expect(rows[0]?.[0]).toHaveProperty('phased', false);
  expect(rows[0]?.[0]?.label).toBe('Page owner'); expect(JSON.stringify(f)).toBe(before);
  expect(hasSpecies(kind)).toBe(false);
});

test('a hull book leaves unrelated driven rows with their other feature owner', () => {
  const f = source(), received: SpeciesRow[][] = [], book = new HullLookBook(f.book);
  const other = { ...f.row, id: 'other.feature', kind: 'other.kind' };
  book.install({ species: values => { received.push('kind' in values ? [values] : [...values]); }, speciesLook: () => undefined }, [], [other, f.row]);
  expect(received[0]?.map(row => row.id)).toEqual([f.row.id]);
  expect(received[0]?.[0]).toHaveProperty('phased', true);
  expect(received[0]?.[0]).not.toBe(f.row); expect(f.row).not.toHaveProperty('phased');
  expect(hasSpecies(kind)).toBe(false);
});
