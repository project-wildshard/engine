// oxlint-disable-next-line import/no-nodejs-modules -- SB25 loads the pinned Pine Hollow product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { object, parse, unknown } from 'valibot';
import { SpeciesSchema } from '@wildshard/format/speciesPrograms';
import { HullLookBook } from '../src/client/game/looks/speciesBook';
import { frozenRuntimeJson } from './fixtures/frozen/snapshots';
import { LEGACY_HEALTH, speciesHealth, variantOf, type SpeciesDef, type VariantTable } from '../src/shared/engine/entities/species/registry';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createNativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { builtFolder } from '../src/test/game/builtFolder';

// SB25 (STAGING-BUGBASH, 2026-11-16): d39d6c1d made the page throw "Species deer has no valid health" for a species
// with no authored hp, so Pine Hollow could not load at all. A missing number falls back to the old built-in health.

test('authored health wins; a species with none gets the pre-d39d6c1d built-in for its aggression', () => {
  expect(LEGACY_HEALTH).toEqual({ grazer: 60, charger: 100 });
  expect(speciesHealth('fixture', 23, 117, true)).toBe(23);
  expect(speciesHealth('fixture', undefined, 117, false)).toBe(117);
  expect(speciesHealth('fixture', undefined, undefined, false)).toBe(60);
  expect(speciesHealth('fixture', undefined, undefined, undefined)).toBe(60);
  expect(speciesHealth('fixture', undefined, undefined, true)).toBe(100);
  for (const hp of [NaN, Infinity, 0, -1]) {
    expect(() => speciesHealth('fixture', hp, undefined, false)).toThrow('fixture');
    expect(() => speciesHealth('fixture', undefined, hp, false)).toThrow('fixture');
  }
});

/** What health reads of a species: its variants, tuning and aggression. */
type HealthSource = VariantTable & Pick<SpeciesDef, 'kind' | 'aggressive' | 'tuning'>;

test('pinned Pine Hollow: the page gives every creature the health the server gives it, its plain deer 60', async () => {
  const directory = builtFolder('pine-hollow'), shard = await loadHeadlessFolder(directory), product = shard.shardfile;
  const descriptor = outputDescriptor(product);
  if (descriptor === undefined) throw new Error('Missing Pine output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const resident = await createNativeHeadlessResident({ shard: product, assets, rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), product: shard });
  try {
    // The page's Pine species, frozen from the full world (test/fixtures/frozen/pine-creature-world.json, boar-world.ts).
    const frozen = parse(object({ boar: SpeciesSchema, elk: SpeciesSchema, looks: unknown() }), frozenRuntimeJson('pine-creature-world.json'));
    const book = new HullLookBook(frozen.looks);
    const species = (kind: string): HealthSource => kind === 'boar' ? frozen.boar : kind === 'elk' ? frozen.elk : book.definition(kind);
    const actors = [...resident.host.entities.values()];
    const deer = actors.filter(actor => actor.kind === 'deer');
    expect(deer.length).toBeGreaterThan(0);
    // Pine authors no deer health: the throw this fixes. Its plain deer keep the old 60; big variants keep their own.
    expect(species('deer').tuning?.hp).toBeUndefined();
    expect(deer.filter(actor => variantOf(species('deer'), actor.variant).hp === undefined).map(actor => actor.maxHp)).toContain(60);
    const checked = new Set<string>();
    for (const actor of actors.filter(row => ['deer', 'boar', 'elk'].includes(row.kind))) {
      checked.add(actor.kind);
      const def = species(actor.kind);
      // The same call AnimalView and RowBodies make (Pine sets no faunaTuning).
      const health = speciesHealth(def.kind, variantOf(def, actor.variant).hp, def.tuning?.hp, def.aggressive);
      expect(health, `${actor.kind}/${actor.variant}`).toBe(actor.maxHp);
    }
    expect([...checked].sort()).toEqual(['boar', 'deer', 'elk']);
  } finally { resident.dispose(); }
}, 120_000);
