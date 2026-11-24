import { expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { publishEntryOwner } from '../src/shared/game/shardfile/entryOwners';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { builtFolder } from '../src/test/game/builtFolder';
import { guestPrograms } from '../src/client/game/shardfile/clientTimedEncounters';
import type { SpeciesCatalogue } from '../src/client/game/looks/speciesBook';
import * as v from 'valibot';
import { ReturnModulesSchema } from '@wildshard/format/scriptContract';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';

// FORMAT-PRUNE FP15: Nalati's night guest (the balbal) reads its view programme from its declared row once the page
// drops the species-program catalogue; a page that keeps the catalogue reads it there.
test("a timed encounter's guest reads its declared projection when the page has no species catalogue", async () => {
  const product = await loadHeadlessFolder(builtFolder('nalati-grasslands')), scope = new Scope('guest');
  try {
    // the page lends its return modules first (clientReturnModules.ts), as its kit does before the night installs
    const rows = v.parse(ReturnModulesSchema, product.section('actors/return-scripts')), assets = new Map<string, Uint8Array>();
    await ReturnProgram.prepareModules(product, assets, rows);
    await ReturnProgram.admitModules(assets, rows, () => Promise.resolve());
    ReturnProgram.lendModules(scope, assets, rows);
    const guest = guestPrograms(scope, 'nalati.species', product.shardfile.rows.species, scope);
    expect(guest.program('balbal')).toBeDefined();
    expect(typeof guest.prepareMemory('balbal', scope)).toBe('boolean');
    expect(() => guest.program('wolf')).toThrow('Timed encounter guest wolf has no species catalogue and no declared projection');
  } finally { scope.dispose(); }
});

test('a page that keeps its species catalogue reads the guest from it', () => {
  const scope = new Scope('catalogue');
  try {
    const catalogue = { program: () => { throw new Error('from the catalogue'); }, prepareMemory: () => false } as unknown as SpeciesCatalogue;
    publishEntryOwner(scope, 'species', 'nalati.species', catalogue);
    expect(guestPrograms(scope, 'nalati.species', [])).toBe(catalogue);
  } finally { scope.dispose(); }
});
