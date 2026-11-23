// ONE-FORMAT OF30: a native roster and ground boss on a product with no `actors/species-programs` read their species from
// the declared rows. Pine Hollow r9 still ships both, so its own programme is the oracle: each native species the roster
// registers, rebuilt from Pine's declared `actors/species` rows (a thrall row lending its spawn-only variant), equals the
// programme's row once both fill their variant mods as the engine's `variantMods` does; the boss's programme rebuilt from
// a binding carries the same decision brain, body recipe and strikes.
import { expect, test } from 'vitest';
import { speciesHealth, variantMods } from '@wildshard/engine/entities/species/registry';
import type { SpeciesData } from '@wildshard/format/speciesPrograms';
import { readSpeciesPrograms } from '@wildshard/format/speciesPrograms';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { declaredBossProgram, declaredHarvest, declaredRosterPopulation } from '../src/server/game/population/declaredNative';
import { builtFolder } from '../src/test/game/builtFolder';

/** What a native consumer reads of one species row: hp and mods filled, motion and calls as given. */
function filled(row: SpeciesData): unknown {
  const variant = (entry: SpeciesData['variants'][number]): unknown => ({ id: entry.id, label: entry.label, weight: entry.weight,
    rarity: entry.rarity, scale: entry.scale, hp: speciesHealth(row.id, entry.hp, row.tuning?.hp, row.aggressive), mods: variantMods(row, entry) });
  return { kind: row.kind, aggressive: row.aggressive === true, tuning: row.tuning, walkSpeed: row.walkSpeed, chargeSpeed: row.chargeSpeed,
    chargeWindup: row.chargeWindup, ringRadius: row.ringRadius, trampleRadius: row.trampleRadius, harvest: row.harvest, sounds: row.sounds,
    variants: row.variants.map(variant), spawnOnly: row.spawnOnly?.map(variant) };
}

test('Pine\'s native species rebuilt from its declared rows match its species programme', async () => {
  const product = await loadHeadlessFolder(builtFolder('pine-hollow')), shard = product.shardfile;
  if (!product.has('actors/species-programs')) return; // Pine has moved: nothing left to compare against
  const programme = readSpeciesPrograms(product.section('actors/species-programs')), hunt = programme.hunt;
  if (hunt === undefined) throw new Error('Pine\'s programme has its hunt');
  const species = [{ id: 'pine.creature.deer' }, { id: 'pine.creature.elk', spawnOnly: ['pine.elk.thrall'] },
    { id: 'pine.creature.boar', spawnOnly: ['pine.boar.thrall'] }, { id: 'pine.creature.bear' }, { id: 'pine.creature.king' }];
  const rebuilt = declaredRosterPopulation(shard.rows, shard.creatures, { species, hunt });
  expect(rebuilt.hunt).toEqual(hunt);
  // The roster's four reserved elite identities are declared spawns now (OF23c): their declared variant hp is the
  // programme's over the elite rank's x4 (OF33b), which only a ranked body restores
  const elites = new Set(['ghost', 'imperial', 'ironhide', 'black-old']), RANK_HP = 4;
  const strip = (rows: readonly unknown[]): unknown => JSON.parse(JSON.stringify(rows, (key, value: unknown) =>
    key === 'variants' && Array.isArray(value) ? value.map((entry: { id: string; hp: number }) => elites.has(entry.id) ? { ...entry, hp: 0 } : entry) : value));
  expect(strip(rebuilt.native.map(filled) as unknown[])).toEqual(strip(programme.native.map(filled) as unknown[]));
  for (const row of programme.native) for (const variant of row.variants) if (elites.has(variant.id))
    expect((rebuilt.native.find(entry => entry.kind === row.kind)?.variants.find(entry => entry.id === variant.id)?.hp ?? 0) * RANK_HP).toBe(variant.hp);
});

test('Pine\'s boss programme rebuilt from a binding keeps its decision, body and strikes', async () => {
  const product = await loadHeadlessFolder(builtFolder('pine-hollow')), shard = product.shardfile;
  if (!product.has('actors/species-programs')) return;
  const programme = readSpeciesPrograms(product.section('actors/species-programs')).program, king = programme?.species.find(row => row.kind === 'antler-king');
  if (programme === undefined || king?.brain?.archetype !== 'decision' || king.body === undefined) throw new Error('Pine\'s King has his programme');
  const rebuilt = declaredBossProgram(shard.rows, 'antler-king', { decision: king.brain.data, body: king.body }, programme.strikes);
  expect(rebuilt.species[0]?.brain).toEqual(king.brain);
  expect(rebuilt.species[0]?.body).toEqual(king.body);
  expect(rebuilt.strikes).toEqual(programme.strikes);
});

test('a declared product restores an older carcass by one declared harvest per kind', async () => {
  const product = await loadHeadlessFolder(builtFolder('pine-hollow'));
  const harvest = declaredHarvest(product.shardfile.rows);
  expect(new Set(harvest.map(row => row.kind)).size).toBe(harvest.length);
  expect(harvest.find(row => row.kind === 'elk')?.harvest?.map(drop => drop.item)).toContain('antlers');
});

test('a roster with no programme and no named species refuses before any body', async () => {
  const product = await loadHeadlessFolder(builtFolder('pine-hollow'));
  expect(() => declaredRosterPopulation(product.shardfile.rows, product.shardfile.creatures, {})).toThrow(/names its declared species/u);
  expect(() => declaredBossProgram(product.shardfile.rows, 'antler-king', {}, [])).toThrow(/decision and body/u);
});
