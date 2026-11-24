// oxlint-disable-next-line import/no-nodejs-modules -- SB25 loads the pinned Pine Hollow product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { creatureRank } from '@wildshard/format/creatureRanks';
import { array, boolean, looseObject, number, object, optional, parse, string } from 'valibot';
import { LEGACY_HEALTH, speciesHealth } from '../src/shared/engine/entities/species/registry';
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

test('pinned Pine Hollow: the page gives every creature the health the server gives it, its plain deer 60', async () => {
  const directory = builtFolder('pine-hollow'), shard = await loadHeadlessFolder(directory), product = shard.shardfile;
  const descriptor = outputDescriptor(product);
  if (descriptor === undefined) throw new Error('Missing Pine output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const resident = await createNativeHeadlessResident({ shard: product, assets, rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), product: shard });
  try {
    // ZONE-SNAPSHOTS ZS9 (J507): the page's Pine species are the live product's declared species rows (actors/species),
    // one kind's rows merged (Pine declares its thralls as a second elk and boar row).
    const declared = parse(object({ rows: object({ species: array(looseObject({ kind: string(), aggressive: boolean(),
      temperament: optional(looseObject({ tuning: optional(looseObject({ hp: optional(number()) })) })),
      variants: array(looseObject({ id: string(), hp: optional(number()) })) })) }) }), shard.section('actors/species')).rows.species;
    const species = (kind: string) => {
      const rows = declared.filter(row => row.kind === kind), first = rows[0];
      if (first === undefined) throw new Error(`Pine declares no ${kind}`);
      const variants = rows.flatMap(row => row.variants);
      return { kind, aggressive: first.aggressive, tuning: first.temperament?.tuning,
        variant: (id: string | undefined) => variants.find(row => row.id === id) ?? variants[0] };
    };
    const ranks = new Map(product.creatures.spawns.flatMap(row => row.rank === undefined ? [] : [[row.id, creatureRank(row.rank).hp] as const]));
    const actors = [...resident.host.entities.values()];
    const deer = actors.filter(actor => actor.kind === 'deer');
    expect(deer.length).toBeGreaterThan(0);
    // Pine r16 authors its deer health now (tuning and every variant); the no-health fallback is the unit test above.
    expect(deer.filter(actor => actor.variant === 'hind').map(actor => actor.maxHp)).toContain(60);
    const checked = new Set<string>();
    for (const actor of actors.filter(row => ['deer', 'boar', 'elk'].includes(row.kind))) {
      checked.add(actor.kind);
      const def = species(actor.kind);
      // The same call AnimalView and RowBodies make (Pine sets no faunaTuning).
      const health = speciesHealth(def.kind, def.variant(actor.variant)?.hp, def.tuning?.hp, def.aggressive);
      // A ranked spawn (Old Ironhide) is the same creature made stronger by its rank's multiplier (declaredRanks.ts).
      expect(health * (ranks.get(actor.entityId) ?? 1), `${actor.kind}/${actor.variant}`).toBe(actor.maxHp);
    }
    expect([...checked].sort()).toEqual(['boar', 'deer', 'elk']);
  } finally { resident.dispose(); }
}, 120_000);
