// ONE-FORMAT OF19c0: declared encounters run beside a native runtime plan. Sunscar Dunes keeps its runtime plan for its
// quest page and held melee (J367 (7)) while its boss moves to a declared `boss` encounter (OF19c1), so the plan's
// keeper may stand nothing (no boss, no owner row) and the quest page's summon (`{ spawn }` on the signal fire) arms the
// declared encounter on that spawn. The fixture is the shipped Dunes product (r5, which ships this shape) with its keeper emptied and one declared
// boss spawn at the Matriarch's arena: the signal fire's summon binds to it; summoned, a player in the arena starts the
// fight, and the host saves and restores it exactly. A declared encounter on a keeper body, and a keeper boss with no owner row, refuse.
// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import * as v from 'valibot';
import { parseNativeRuntimePlan } from '@wildshard/format/nativeRuntimePlan';
import { parseDecisionScripts } from '@wildshard/format/decisionScripts';
import { parseShardfile, type Shardfile } from '@wildshard/format/shardSchema';
import type { ShardRows } from '@wildshard/format/rows';
import type { ShardCreatures } from '@wildshard/format/creatures';
import { loadHeadlessFolder } from '@wildshard/engine/host/headlessFolder';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import { createSimHost, type SimHost } from '../src/server/engine/sim';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { prepareRuntimePlan, prepareRuntimeWorld, type NativeRuntimeRecipe } from '../src/server/game/plugin/simulation';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { emptyShardfile } from '../src/shared/host/author';
import { canonicalSimDigest } from '../src/test/engine/simState';
import { builtFolder, runtimeAssets } from './fixtures/engine-lift/folder';

const rows = JSON.parse(readFileSync('test/fixtures/dunes-of11b-rows.json', 'utf8')) as {
  rows: { species: ShardRows['species']; brains: ShardCreatures['brains']; strikes: ShardRows['strikes'] };
};
type Plan = ReturnType<typeof parseNativeRuntimePlan>;
const BOSS = 'sunscar.matriarch', FIGHT = BOSS, ARENA: readonly [number, number] = [-14, -141];

/** Dunes r4's keeper boss row, frozen from that pin: r5's keeper stands no boss (its Matriarch is the declared encounter). */
const KEEPER_BOSS = { at: [-14, -150], id: BOSS, kind: 'duneMatriarch', look: 'matriarch', yaw: 0 };
interface Dunes { shard: Shardfile; assets: Map<string, Uint8Array>; sections: ReadonlyMap<string, unknown>; plan: Plan; rapier: Rapier }
async function dunes(): Promise<Dunes> {
  const directory = builtFolder('sunscar-dunes'), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing verified Dunes product');
  return { shard: product.shardfile, assets: runtimeAssets(product, directory), sections: descriptor.sections,
    plan: parseNativeRuntimePlan(product.section('sim/runtime-plan')),
    rapier: await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))) };
}
/** The plan's keeper standing nothing: no homes, no holds, no boss and no owner row. */
function emptied(plan: Plan): NativeRuntimeRecipe {
  const { boss: _boss, holds: _holds, ...kept } = plan.recipe.population.rows, { owner: _owner, ...population } = plan.recipe.population;
  return { ...plan.recipe, population: { ...population, rows: { ...kept, homes: [] } } } as unknown as NativeRuntimeRecipe;
}
/** The shipped shard with one declared boss spawn (the strider's body, its temperament brain `none`) and its `spawned` boss encounter. */
function declaring(source: Shardfile, ground: number): Shardfile {
  const strider = rows.rows.species.find(row => row.kind === 'duneStrider');
  if (strider === undefined) throw new Error('Missing converted strider');
  const species = [{ ...strider, id: 'of19c0.creature.boss', kind: 'of19c0Boss', body: { ...strider.body, look: 'of19c0.look.boss' },
    temperament: { ...strider.temperament, brain: 'none' } }] as ShardRows['species'];
  const base = emptyShardfile({ slug: 'of19c0-rows', name: 'Rows', author: 'Test', revision: 1, seed: 7 });
  const looks = [{ id: 'of19c0.look.boss', species: 'of19c0.creature.boss', recipe: 'sunscar.rig', material: null, parameters: {}, animation: { recipe: 'sunscar.clips', parameters: {} } }];
  const at: [number, number, number] = [ARENA[0], ground, ARENA[1]];
  const parsed = parseShardfile({ ...base, rows: { ...base.rows, species, strikes: rows.rows.strikes, looks },
    creatures: { ...base.creatures, spawns: [{ id: BOSS, species: 'of19c0.creature.boss', variant: 'dusk', brain: null, strike: null, seed: 3, scale: 1, at, yaw: 0 }] },
    encounters: [{ id: FIGHT, entity: BOSS, kind: 'boss', panel: null, name: 'Dune Matriarch', title: 'Mother of the Sands', retry: 'Again',
      start: 'spawned', arena: { at, radius: 30 }, intro: 0.5, introShort: 0.25, respawn: { at: [ARENA[0], ground, ARENA[1] + 20], yaw: 0 },
      phases: [{ at: 1, name: 'one', caption: 'She rises', speed: 4, stopDistance: 2, turnRate: 6 }, { at: 0.5, name: 'two', caption: 'She rages', speed: 6, stopDistance: 2, turnRate: 8 }] }] });
  const strikes = [...source.rows.strikes.filter(row => !parsed.rows.strikes.some(entry => entry.id === row.id)), ...parsed.rows.strikes];
  return { ...source, rows: { ...source.rows, species: [...source.rows.species, ...parsed.rows.species], strikes,
    looks: [...source.rows.looks, ...parsed.rows.looks] }, creatures: { ...parsed.creatures, brains: source.creatures.brains }, encounters: parsed.encounters };
}
const fightState = v.object({ boss: v.object({ state: v.string(), phase: v.number() }) });
function fight(host: SimHost): { state: string; phase: number } {
  const slot = snapshotSimHost(host).adapters.find(row => row.id === `encounter.${FIGHT}`);
  if (typeof slot?.state !== 'string') throw new Error('Missing declared encounter step');
  return v.parse(fightState, JSON.parse(slot.state)).boss;
}
const context = (restoring: boolean, snapshot?: ReturnType<typeof snapshotSimHost>) => ({ restoring, ...(snapshot === undefined ? {} : { snapshot }), emit: () => undefined, commands: () => [] });

/** The cell's sections for an emptied keeper. The plan's section still names its owner row (format), so the cell reads the
 *  emptied recipe without it: a keeper that stands nothing names no native actor to the decision catalogue. The Matriarch's
 *  decision row (the packs' rows bind homes this shard does not declare) moves from the keeper to the encounter's body. */
function cellSections(fixture: Dunes): Map<string, unknown> {
  const sections = new Map(fixture.sections); sections.delete('sim/runtime-plan');
  sections.set('sim/scripts', parseDecisionScripts(fixture.sections.get('sim/scripts')).filter(row => row.id === 'sunscar.matriarch.decision'));
  return sections;
}

test('the quest page binds its summon to a declared boss encounter beside a runtime plan whose keeper stands nothing', async () => {
  const fixture = await dunes(), recipe = emptied(fixture.plan), sections = cellSections(fixture);
  const probe = await prepareRuntimePlan(fixture.shard, fixture.assets, fixture.plan.baked, fixture.plan.recipe, fixture.sections);
  const shard = declaring(fixture.shard, probe.ports.heightAt(ARENA[0], ARENA[1]));
  // with no keeper boss and no declared one, the signal fire's `{ spawn: sunscar.matriarch }` has no owner
  const bareSections = new Map(sections); bareSections.set('sim/scripts', []);
  const bare = await prepareRuntimePlan({ ...fixture.shard, creatures: { ...fixture.shard.creatures, spawns: [] } },
    fixture.assets, fixture.plan.baked, recipe, bareSections);
  const empty = createSimHost(bare.level, { ...bare.ports, rapier: fixture.rapier });
  try { expect(() => { bare.install(empty, context(false)); }).toThrow(/Unbound quest encounter sunscar.matriarch/u); } finally { empty.dispose(); }
  // the declared encounter on that spawn answers it
  const plan = await prepareRuntimePlan(shard, fixture.assets, fixture.plan.baked, recipe, sections);
  expect(plan.level.entities.map(row => row.id)).toEqual([BOSS]);
  const host = createSimHost(plan.level, { ...plan.ports, rapier: fixture.rapier });
  try { plan.install(host, context(false)); expect(fight(host).state).toBe('dormant'); } finally { host.dispose(); }
}, 120_000);

test('a declared boss waits out of the world for its summon, rises with its decision row, and saves', async () => {
  const fixture = await dunes(), recipe = emptied(fixture.plan), sections = cellSections(fixture);
  const probe = await prepareRuntimePlan(fixture.shard, fixture.assets, fixture.plan.baked, fixture.plan.recipe, fixture.sections);
  const ground = probe.ports.heightAt(ARENA[0], ARENA[1]), shard = declaring(fixture.shard, ground);
  const world = await prepareRuntimeWorld(shard, fixture.assets, fixture.plan.baked, recipe, sections);
  const host = createSimHost(world.level, { ...world.ports, rapier: fixture.rapier });
  const install = (target: SimHost, restoring: boolean, snapshot?: ReturnType<typeof snapshotSimHost>) => {
    const environment = world.install(target, context(restoring, snapshot)); return environment; };
  try {
    const environment = install(host, false), player = leadPlayer(host);
    host.events.answer('damage.modify', request => request?.target === player.health ? null : request, host.scope);
    const stand = (): void => { player.position.set(ARENA[0], ground + 0.1, ARENA[1] + 5); player.velocity.set(0, 0, 0); };
    // unsummoned, the fight waits and its body is out of the world, even with a player in the arena
    for (let i = 0; i < 60; i++) { stand(); host.step(); }
    expect(fight(host).state).toBe('dormant');
    expect(host.entities.get(BOSS)?.position.y).toBeLessThan(-1000);
    // summoned, it arms; the player in its arena starts it and its body stands at home
    environment.declared.get(BOSS)?.summon();
    for (let i = 0; i < 240; i++) { stand(); host.step(); }
    expect(['intro', 'fight']).toContain(fight(host).state);
    expect(host.entities.get(BOSS)?.position.y).toBeGreaterThan(ground - 5);
    expect(host.entities.get(BOSS)?.alive).toBe(true);
    // a save mid-fight restores exactly, and both go on the same
    const saved = snapshotSimHost(host);
    const restored = restoreSimHost(world.level, { ...world.ports, rapier: fixture.rapier }, saved, fresh => { install(fresh, true, saved); });
    try {
      expect(canonicalSimDigest(snapshotSimHost(restored))).toBe(canonicalSimDigest(saved));
      for (let i = 0; i < 120; i++) { host.step(); restored.step(); }
      expect(canonicalSimDigest(snapshotSimHost(restored))).toBe(canonicalSimDigest(snapshotSimHost(host)));
    } finally { restored.dispose(); }
  } finally { host.dispose(); }
}, 120_000);

test('a runtime plan whose keeper stands a boss or a home refuses (FORMAT-PRUNE FP53b)', async () => {
  const fixture = await dunes();
  const probe = await prepareRuntimePlan(fixture.shard, fixture.assets, fixture.plan.baked, fixture.plan.recipe, fixture.sections);
  const shard = declaring(fixture.shard, probe.ports.heightAt(ARENA[0], ARENA[1]));
  const retired = /keeper homes, boss and species are retired/u;
  // the keeper's own boss, with or without the owner row that fought it: the boss is a declared encounter now
  const { holds: _holds, ...kept } = fixture.plan.recipe.population.rows;
  const keeper = { ...fixture.plan.recipe, population: { ...fixture.plan.recipe.population, rows: { ...kept, homes: [], boss: KEEPER_BOSS } } } as unknown as NativeRuntimeRecipe;
  await expect(prepareRuntimePlan(shard, fixture.assets, fixture.plan.baked, keeper, fixture.sections)).rejects.toThrow(retired);
  const { owner: _owner, ...population } = keeper.population;
  const ownerless = { ...keeper, population } as unknown as NativeRuntimeRecipe;
  await expect(prepareRuntimePlan(fixture.shard, fixture.assets, fixture.plan.baked, ownerless, fixture.sections)).rejects.toThrow(retired);
  // a keeper home: the creature is a declared spawn now
  const homed = { ...fixture.plan.recipe, population: { ...fixture.plan.recipe.population,
    rows: { ...kept, homes: [{ id: 'retired.home', kind: KEEPER_BOSS.kind, at: [0, 0], yaw: 0, respawn: 30 }] } } } as unknown as NativeRuntimeRecipe;
  await expect(prepareRuntimePlan(fixture.shard, fixture.assets, fixture.plan.baked, homed, fixture.sections)).rejects.toThrow(retired);
}, 120_000);
