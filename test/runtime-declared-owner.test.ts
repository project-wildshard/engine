// ONE-FORMAT OF20c / OF19c1 (shared engine row): a declared boss encounter beside a runtime plan takes the plan's owner
// row's hooks. The keeper's boss (Sky's held Storm Roc, Dunes' spawned Matriarch) carried its victory flag and fact, its
// coin reward and its saved record on the plan's owner row; a declared encounter beside the plan installed with empty
// save and reward hooks, so moving the boss off the keeper lost all three. Now the plan keeps its owner row, naming the
// declared spawn, and that encounter files the row's flag and fact, pays its coins (on the win, or once as a claim),
// keeps its record flags, never pays for a fall, and saves and restores exactly. The fixture is the shipped Dunes
// product with its keeper emptied (no homes, no boss) but its owner row kept, and one declared boss at the arena.
// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import * as v from 'valibot';
import { parseNativeRuntimePlan } from '@wildshard/format/nativeRuntimePlan';
import { parseShardfile, type Shardfile } from '@wildshard/format/shardSchema';
import type { ShardRows } from '@wildshard/format/rows';
import type { ShardCreatures } from '@wildshard/format/creatures';
import { loadHeadlessFolder } from '@wildshard/engine/host/headlessFolder';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import { createSimHost, type SimHost } from '../src/server/engine/sim';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { prepareRuntimePlan, prepareRuntimeWorld, type NativeRuntimeEffect, type NativeRuntimeRecipe } from '../src/server/game/plugin/simulation';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { shardRows } from '../src/shared/engine/sim/shardRows';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { emptyShardfile } from '../src/shared/host/author';
import { canonicalSimDigest } from '../src/test/engine/simState';
import { builtFolder, runtimeAssets } from './fixtures/engine-lift/folder';

const rows = JSON.parse(readFileSync('test/fixtures/dunes-of11b-rows.json', 'utf8')) as {
  rows: { species: ShardRows['species']; brains: ShardCreatures['brains']; strikes: ShardRows['strikes'] };
};
type Plan = ReturnType<typeof parseNativeRuntimePlan>;
type Owner = NonNullable<Plan['recipe']['population']['owner']>;
const BOSS = 'sunscar.matriarch', FIGHT = 'of20c.fight', ARENA: readonly [number, number] = [-14, -141];

interface Dunes { shard: Shardfile; assets: Map<string, Uint8Array>; sections: ReadonlyMap<string, unknown>; plan: Plan; rapier: Rapier }
async function dunes(): Promise<Dunes> {
  const directory = builtFolder('sunscar-dunes'), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing verified Dunes product');
  return { shard: product.shardfile, assets: runtimeAssets(product, directory), sections: descriptor.sections,
    plan: parseNativeRuntimePlan(product.section('sim/runtime-plan')),
    rapier: await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))) };
}
/** The plan's keeper standing nothing (no homes, no holds, no boss) while its owner row stays, naming the declared spawn. */
function keeperless(plan: Plan, owner: (row: Owner) => Owner = row => row): NativeRuntimeRecipe {
  const { boss: _boss, holds: _holds, ...kept } = plan.recipe.population.rows, row = plan.recipe.population.owner;
  if (row === undefined) throw new Error('Missing Dunes owner row');
  return { ...plan.recipe, population: { ...plan.recipe.population, owner: owner(row), rows: { ...kept, homes: [] } } } as unknown as NativeRuntimeRecipe;
}
/** The shipped shard with one declared boss spawn (the strider's body, no brain) and its `spawned` boss encounter. */
function declaring(source: Shardfile, ground: number): Shardfile {
  const strider = rows.rows.species.find(row => row.kind === 'duneStrider');
  if (strider === undefined) throw new Error('Missing converted strider');
  const species = [{ ...strider, id: 'of20c.creature.boss', kind: 'of20cBoss', body: { ...strider.body, look: 'of20c.look.boss' },
    temperament: { ...strider.temperament, brain: 'none' } }] as ShardRows['species'];
  const base = emptyShardfile({ slug: 'of20c-rows', name: 'Rows', author: 'Test', revision: 1, seed: 7 });
  const looks = [{ id: 'of20c.look.boss', species: 'of20c.creature.boss', recipe: 'sunscar.rig', material: null, parameters: {}, animation: { recipe: 'sunscar.clips', parameters: {} } }];
  const at: [number, number, number] = [ARENA[0], ground, ARENA[1]];
  const parsed = parseShardfile({ ...base, rows: { ...base.rows, species, strikes: rows.rows.strikes, looks },
    creatures: { ...base.creatures, spawns: [{ id: BOSS, species: 'of20c.creature.boss', variant: 'dusk', brain: null, strike: 'sunscar.strider.horns', seed: 3, scale: 1, at, yaw: 0 }] },
    encounters: [{ id: FIGHT, entity: BOSS, kind: 'boss', panel: null, name: 'Dune Matriarch', title: 'Mother of the Sands', retry: 'Again',
      start: 'spawned', arena: { at, radius: 30 }, intro: 0.25, introShort: 0.25, respawn: { at: [ARENA[0], ground, ARENA[1] + 20], yaw: 0 },
      phases: [{ at: 1, name: 'one', caption: 'She rises', speed: 0, stopDistance: 2, turnRate: 6 }, { at: 0.5, name: 'two', caption: 'She rages', speed: 0, stopDistance: 2, turnRate: 8 }] }] });
  return { ...source, rows: { ...source.rows, species: [...source.rows.species, ...parsed.rows.species], strikes: [...source.rows.strikes, ...parsed.rows.strikes],
    looks: [...source.rows.looks, ...parsed.rows.looks] },
    // the shipped brains stay: Dunes r4's species rows name them (its declared homes leave with their spawns)
    creatures: { ...parsed.creatures, brains: source.creatures.brains }, encounters: parsed.encounters };
}
const fightState = v.object({ boss: v.object({ state: v.string(), phase: v.number(), saved: v.object({ defeated: v.boolean(), rewardTaken: v.boolean(), kills: v.number() }) }) });
function fight(host: SimHost): v.InferOutput<typeof fightState>['boss'] {
  const slot = snapshotSimHost(host).adapters.find(row => row.id === `encounter.${FIGHT}`);
  if (typeof slot?.state !== 'string') throw new Error('Missing declared encounter step');
  return v.parse(fightState, JSON.parse(slot.state)).boss;
}
/** No decision row drives the boss: its phase chase stands still (speed 0), so the proof's blows decide the fight. */
function cellSections(fixture: Dunes): Map<string, unknown> {
  const sections = new Map(fixture.sections); sections.delete('sim/runtime-plan'); sections.set('sim/scripts', []);
  return sections;
}

interface Arena { host: SimHost; effects: NativeRuntimeEffect[]; world: Awaited<ReturnType<typeof prepareRuntimeWorld>>; fixture: Dunes; ground: number;
  install: (target: SimHost, restoring: boolean, snapshot?: ReturnType<typeof snapshotSimHost>) => void }
async function arena(owner?: (row: Owner) => Owner): Promise<Arena> {
  const fixture = await dunes(), recipe = keeperless(fixture.plan, owner), sections = cellSections(fixture);
  const probe = await prepareRuntimePlan(fixture.shard, fixture.assets, fixture.plan.baked, fixture.plan.recipe, fixture.sections);
  const ground = probe.ports.heightAt(ARENA[0], ARENA[1]), shard = declaring(fixture.shard, ground);
  const world = await prepareRuntimeWorld(shard, fixture.assets, fixture.plan.baked, recipe, sections);
  const effects: NativeRuntimeEffect[] = [];
  const install = (target: SimHost, restoring: boolean, snapshot?: ReturnType<typeof snapshotSimHost>): void => {
    const environment = world.install(target, { restoring, ...(snapshot === undefined ? {} : { snapshot }), emit: effect => { effects.push(effect); } });
    if (!restoring) environment.declared.get(BOSS)?.summon();
  };
  const host = createSimHost(world.level, { ...world.ports, rapier: fixture.rapier });
  install(host, false);
  return { host, effects, world, fixture, ground, install };
}
/** The player stands in the arena, unhurt; each tick a player blow lands on the boss while the fight takes it. */
function fightOn(context: Arena, ticks: number, until: () => boolean, blow = 40, off = 5): void {
  const { host, ground } = context, player = leadPlayer(host), body = host.entities.get(BOSS);
  if (body === undefined) throw new Error('Missing declared boss');
  host.events.answer('damage.modify', request => request?.target === player.health ? null : request, host.scope);
  for (let i = 0; i < ticks && !until(); i++) {
    player.position.set(ARENA[0], ground + 0.1, ARENA[1] + off); player.velocity.set(0, 0, 0);
    if (blow > 0 && fight(host).state === 'fight' && body.alive) host.combat.hit({ source: player.health, sourceTags: ['actor.player'], target: body.combatActor(), amount: blow,
      point: body.position.clone(), dir: new Vector3(), cause: { kind: 'test', label: 'test' } });
    host.step();
  }
}
const facts = (effects: readonly NativeRuntimeEffect[]): string[] => effects.flatMap(row => row.kind === 'fact' ? [row.name] : []);
const coins = (effects: readonly NativeRuntimeEffect[]): number => effects.reduce((sum, row) => sum + (row.kind === 'coins' ? row.amount : 0), 0);

test('a declared boss beside a runtime plan files its owner row\'s victory, pays its claim once, keeps its record and restores exactly', async () => {
  const context = await arena(), { host, effects, world, fixture } = context;
  try {
    const owner = fixture.plan.recipe.population.owner;
    if (owner?.record === undefined) throw new Error('Dunes\' owner row keeps its record flags');
    expect(owner.reward).toEqual({ when: 'claim', amount: 20 });
    fightOn(context, 2400, () => fight(host).state === 'victory');
    expect(fight(host).state).toBe('victory');
    // the owner row's victory: its flag and its fact, and its claim paid once
    expect(host.flags.has(owner.victory.flag)).toBe(true);
    expect(facts(effects)).toEqual([owner.victory.fact]);
    expect(coins(effects)).toBe(owner.reward.amount);
    // its record: beaten and paid, in the flags the page and a save read
    expect(fight(host).saved).toMatchObject({ defeated: true, rewardTaken: true, kills: 1 });
    expect(host.flags.has(owner.record.defeated)).toBe(true);
    expect(host.flags.has(owner.record.paid)).toBe(true);
    // a save restores exactly and pays nothing again; both go on the same
    const saved = snapshotSimHost(host), before = effects.length;
    const restored = restoreSimHost(world.level, { ...world.ports, rapier: fixture.rapier }, saved, fresh => { context.install(fresh, true, saved); });
    try {
      expect(canonicalSimDigest(snapshotSimHost(restored))).toBe(canonicalSimDigest(saved));
      for (let i = 0; i < 120; i++) { host.step(); restored.step(); }
      expect(canonicalSimDigest(snapshotSimHost(restored))).toBe(canonicalSimDigest(snapshotSimHost(host)));
      expect(effects.length).toBe(before);
    } finally { restored.dispose(); }
  } finally { host.dispose(); }
}, 120_000);

test('a victory reward pays on the win, once by its flag; a boss the fall kills files and pays nothing', async () => {
  const sky = (row: Owner): Owner => { const { record: _record, ...rest } = row;
    return { ...rest, saved: { defeated: false, rewardTaken: false, kills: 0 }, reward: { when: 'victory', amount: 25 }, victory: { ...row.victory, once: true } }; };
  const won = await arena(sky);
  try {
    fightOn(won, 2400, () => fight(won.host).state === 'victory');
    expect(fight(won.host).state).toBe('victory');
    expect(facts(won.effects)).toEqual(['sunscar.matriarch']);
    expect(coins(won.effects)).toBe(25);
  } finally { won.host.dispose(); }
  const fell = await arena(sky), { host } = fell, body = host.entities.get(BOSS);
  try {
    if (body === undefined) throw new Error('Missing declared boss');
    // blows bring her to her last phase; the fall finishes her
    fightOn(fell, 2400, () => fight(host).phase === 1 && fight(host).state === 'fight');
    expect(fight(host).phase).toBe(1);
    host.combat.fall(body.combatActor(), body.position.clone(), { kind: 'out-of-world', label: 'fall' });
    fightOn(fell, 60, () => fight(host).state === 'victory', 0);
    expect(fight(host).state).toBe('victory');
    expect(host.flags.has('sunscar.matriarch.down')).toBe(false);
    expect(facts(fell.effects)).toEqual([]);
    expect(coins(fell.effects)).toBe(0);
  } finally { host.dispose(); }
}, 120_000);

test('an owner row on a declared spawn with no boss encounter refuses', async () => {
  const fixture = await dunes(), probe = await prepareRuntimePlan(fixture.shard, fixture.assets, fixture.plan.baked, fixture.plan.recipe, fixture.sections);
  const shard = declaring(fixture.shard, probe.ports.heightAt(ARENA[0], ARENA[1]));
  await expect(prepareRuntimeWorld({ ...shard, encounters: [] }, fixture.assets, fixture.plan.baked, keeperless(fixture.plan), cellSections(fixture)))
    .rejects.toThrow(/names declared spawn sunscar.matriarch, which has no boss encounter/u);
}, 120_000);

test('a declared owner boss says its strikes as the keeper\'s did, so a page\'s lane sheet draws them', async () => {
  const context = await arena(), { host } = context, said = new Set<string>();
  try {
    const body = host.entities.get(BOSS);
    if (body === undefined) throw new Error('Missing declared boss');
    fightOn(context, 600, () => fight(host).state === 'fight', 0);
    expect(fight(host).state).toBe('fight');
    for (let i = 0; i < 600 && said.size === 0; i++) {
      shardRows(host).calls.length = 0; fightOn(context, 1, () => false, 0, 1.5);
      for (const call of shardRows(host).calls) if (call.name.startsWith('boss.strike.')) said.add(call.name);
    }
    const strike = host.strikes.get(BOSS)?.spec?.id;
    expect(strike).toBeDefined();
    expect([...said]).toEqual([`boss.strike.${strike ?? ''}`]);
  } finally { host.dispose(); }
}, 120_000);

// OF19c1: Dunes' owner row carries the Matriarch's spawned profile, whose marks her grounded clips and page read (`fight`,
// `rise`, `phase` in her body's memory, said to the page as pose inputs). A declared boss on that row keeps them: the rise
// counts up through the intro, the fight mark stands through fight and beat, and the phase mark follows the fight's phase.
test('a declared boss on a spawned profile keeps its marks: rise through the intro, fight, and the phase it fights', async () => {
  const context = await arena(), { host, world, fixture } = context, body = host.entities.get(BOSS);
  try {
    const owner = fixture.plan.recipe.population.owner;
    if (body === undefined || owner?.profile.pattern !== 'spawned') throw new Error('Dunes\' owner row keeps its spawned profile');
    const fields = owner.profile.fight.fields, seen = { intro: [] as number[], phases: new Set<number>(), fight: new Set<number>() };
    for (let i = 0; i < 2400 && fight(host).state !== 'victory'; i++) {
      // the marks step runs before the fight's own, so a step's marks are the fight as the step began
      const now = fight(host);
      fightOn(context, 1, () => false, now.state === 'fight' ? 40 : 0);
      if (now.state === 'intro') seen.intro.push(body.mem[fields.rise] ?? -1);
      if (now.state === 'fight' || now.state === 'beat') { seen.fight.add(body.mem[fields.fight] ?? -1); seen.phases.add(body.mem[fields.phase] ?? -1);
        expect(body.mem[fields.phase]).toBe(now.phase); expect(body.mem[fields.rise]).toBe(1); }
    }
    expect(fight(host).state).toBe('victory');
    expect(seen.intro.length).toBeGreaterThan(2);
    expect(seen.intro.every((rise, i) => rise > 0 && rise < 1 && (i === 0 || rise > (seen.intro[i - 1] ?? 0)))).toBe(true);
    expect([...seen.fight]).toEqual([1]);
    expect([...seen.phases].sort()).toEqual([0, 1]);
    fightOn(context, 2, () => false, 0);
    expect(body.mem[fields.fight]).toBe(0);
    const saved = snapshotSimHost(host);
    const restored = restoreSimHost(world.level, { ...world.ports, rapier: fixture.rapier }, saved, fresh => { context.install(fresh, true, saved); });
    try { expect(canonicalSimDigest(snapshotSimHost(restored))).toBe(canonicalSimDigest(saved)); } finally { restored.dispose(); }
  } finally { host.dispose(); }
}, 120_000);
