import { expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { builtFolder } from '../src/test/game/builtFolder';
import { guestPrograms } from '../src/client/game/shardfile/clientTimedEncounters';
import * as v from 'valibot';
import { ReturnModulesSchema } from '@wildshard/format/scriptContract';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';

// FORMAT-PRUNE FP15, FP20: Nalati's night guest (the balbal) reads its view programme from its declared row (no species
// catalogue owns it any more).
test("a timed encounter's guest reads its declared projection when the page has no species catalogue", async () => {
  const product = await loadHeadlessFolder(builtFolder('nalati-grasslands')), scope = new Scope('guest');
  try {
    // the page lends its return modules first (clientReturnModules.ts), as its kit does before the night installs
    const rows = v.parse(ReturnModulesSchema, product.section('actors/return-scripts')), assets = new Map<string, Uint8Array>();
    await ReturnProgram.prepareModules(product, assets, rows);
    await ReturnProgram.admitModules(assets, rows, () => Promise.resolve());
    ReturnProgram.lendModules(scope, assets, rows);
    const guest = guestPrograms(product.shardfile.rows.species, scope);
    expect(guest.program('balbal')).toBeDefined();
    expect(typeof guest.prepareMemory('balbal', scope)).toBe('boolean');
    expect(() => guest.program('wolf')).toThrow('Timed encounter guest wolf has no declared projection');
  } finally { scope.dispose(); }
});
