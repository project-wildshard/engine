import { expect, it } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { SpeciesService } from '../src/client/engine/entities/species/look';
import type { SpeciesRow } from '../src/server/engine/ai/species';

// DL24 (J198): the boot parks one rig of every kind a row can bring; `kinds()` is the active level's own list.
it('lists the kinds the active level registered, and none after its scope leaves', () => {
  const page = new Scope('page'), level = page.child('level'), other = page.child('other');
  let active: Scope | null = level;
  const species = new SpeciesService(() => active);
  const row = (kind: string): SpeciesRow => ({ id: `row.${kind}`, kind } as unknown as SpeciesRow);
  species.registerRow(row('stormRoc'), level);
  species.registerRow(row('skyGoat'), level);
  species.registerRow(row('boar'), other);
  expect(species.kinds().sort()).toEqual(['skyGoat', 'stormRoc']);
  expect(species.rowId('stormRoc')).toBe('row.stormRoc'); expect(species.rowId('boar')).toBeUndefined();
  const nested = level.child('override');
  species.registerRow({ ...row('stormRoc'), id: 'nested.stormRoc' }, nested);
  expect(species.rowId('stormRoc')).toBe('nested.stormRoc');
  nested.dispose(); expect(species.rowId('stormRoc')).toBe('row.stormRoc');
  active = other;
  expect(species.kinds()).toEqual(['boar']);
  expect(species.rowId('boar')).toBe('row.boar'); expect(species.rowId('stormRoc')).toBeUndefined();
  active = level;
  level.dispose();
  expect(species.kinds()).toEqual([]); expect(species.rowId('stormRoc')).toBeUndefined();
  active = null;
  expect(species.kinds()).toEqual([]); expect(species.rowId('boar')).toBeUndefined();
});
