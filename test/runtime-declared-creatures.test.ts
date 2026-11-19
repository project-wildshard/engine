// ONE-FORMAT OF19b0: a native runtime plan runs declared creature rows. Sunscar Dunes keeps its runtime plan (quest page,
// held melee: J367 (7)) while its creatures move to rows (OF19b), so the cell's native resident must stand and drive
// declared spawns beside the plan's keeper. The fixture is the shipped Dunes product with its keeper cut to its boss and
// OF11a's converted rows (`fixtures/dunes-of11b-rows.json`) as declared spawns: the ray and the strider run on the
// resident tick for tick as the keeper runs them (as `data-host-dunes-parity.test.ts`), the resident saves and restores
// them, the Matriarch's decision row stays with the keeper beside them, and a body or decision row both owners claim
// refuses.
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
import { prepareRuntimeWorld } from '../src/server/game/plugin/simulation';
import { seedSlot, type BrainedSpecies } from '../src/server/game/plugin/brain';
import { createNativeHeadlessResident, type HeadlessRuntimeInput } from '../src/server/host/headlessRuntime';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { emptyShardfile } from '../src/shared/host/author';
import { canonicalSimDigest } from '../src/test/engine/simState';
import { builtFolder, runtimeAssets } from './fixtures/engine-lift/folder';

const rows = JSON.parse(readFileSync('test/fixtures/dunes-of11b-rows.json', 'utf8')) as {
  program: { species: BrainedSpecies[] };
  rows: { species: ShardRows['species']; brains: ShardCreatures['brains']; strikes: ShardRows['strikes'] };
};
type Plan = ReturnType<typeof parseNativeRuntimePlan>;
type Spawn = ShardCreatures['spawns'][number];
const RAY = 'sunscar.home:0', STRIDER = 'sunscar.home:11', TICKS = 600;
/** The fixture's decision rows: the Matriarch's alone (it declares no skitterer, so the pack's row goes with them). */
const MATRIARCH = (sections: ReadonlyMap<string, unknown>): unknown => parseDecisionScripts(sections.get('sim/scripts')).filter(row => row.id === 'sunscar.matriarch.decision');

interface Dunes { shard: Shardfile; assets: Map<string, Uint8Array>; sections: ReadonlyMap<string, unknown>; plan: Plan; rapier: Rapier }
async function dunes(): Promise<Dunes> {
  const directory = builtFolder('sunscar-dunes'), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing verified Dunes product');
  return { shard: product.shardfile, assets: runtimeAssets(product, directory), sections: descriptor.sections,
    plan: parseNativeRuntimePlan(product.section('sim/runtime-plan')),
    rapier: await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))) };
}
/** The plan with its keeper holding only `homes` beside its boss. A hold (the ray's, until the scout flag) is dropped: the
 *  declared ray has no hold row, as OF11b's has none, and OF19b carries it. */
function keeping(plan: Plan, homes: readonly string[]): Plan {
  const { holds: _holds, ...rows } = plan.recipe.population.rows;
  return { ...plan, recipe: { ...plan.recipe, population: { ...plan.recipe.population,
    rows: { ...rows, homes: rows.homes.filter(home => homes.includes(home.id)) } } } };
}
/** The shipped shard with these declared rows and spawns (parsed on an empty shard, so their defaults are the format's). */
function declaring(source: Shardfile, species: ShardRows['species'], spawns: readonly Spawn[]): Shardfile {
  const base = emptyShardfile({ slug: 'of19b0-rows', name: 'Rows', author: 'Test', revision: 1, seed: 7 });
  const looks = species.map(row => ({ id: `sunscar.look.${row.kind}`, species: row.id, recipe: 'sunscar.rig', material: null,
    parameters: {}, animation: { recipe: 'sunscar.clips', parameters: {} } }));
  const parsed = parseShardfile({ ...base, rows: { ...base.rows, species, strikes: rows.rows.strikes, looks },
    creatures: { ...base.creatures, brains: rows.rows.brains, spawns } });
  return { ...source, rows: { ...source.rows, species: parsed.rows.species, strikes: [...source.rows.strikes, ...parsed.rows.strikes],
    looks: [...source.rows.looks, ...parsed.rows.looks] }, creatures: parsed.creatures };
}
/** The cell's input: the shard, its assets and its sections with this runtime plan and decision rows. */
function input(fixture: Dunes, shard: Shardfile, plan: Plan, scripts?: (sections: ReadonlyMap<string, unknown>) => unknown): HeadlessRuntimeInput {
  const sections = new Map(fixture.sections); sections.set('sim/runtime-plan', plan);
  if (scripts !== undefined) sections.set('sim/scripts', scripts(fixture.sections));
  return { shard, assets: fixture.assets, rapier: fixture.rapier, sections };
}

/** The player stands in reach of both, then walks off and back, on the dune's own ground. */
function playerAt(tick: number): { x: number; z: number } {
  const t = tick / 60;
  return t < 4 ? { x: 8, z: -58 } : t < 7 ? { x: 8 + (t - 4) * 3, z: -58 + (t - 4) * 2 } : { x: 17 - (t - 7) * 2, z: -52 - (t - 7) };
}
interface Frame { readonly x: number; readonly y: number; readonly z: number; readonly attack: number; readonly state: string }
interface Hit { readonly tick: number; readonly amount: number; readonly tags: readonly string[] }
function frame(host: SimHost, id: string): Frame {
  const actor = host.entities.get(id); if (actor === undefined) throw new Error(`Missing body ${id}`);
  return { x: actor.position.x, y: actor.position.y, z: actor.position.z, attack: actor.attackPhase, state: actor.state };
}
function hold(host: SimHost, tick: number): void {
  const player = leadPlayer(host), at = playerAt(tick);
  player.position.set(at.x, host.groundHeightAt(at.x, at.z), at.z); player.velocity.set(0, 0, 0); player.impulse.set(0, 0, 0);
  player.health.attributes.health = player.health.attributes.maxHealth;
}
/** Step a host with the scripted player, recording the two bodies and every blow landed on the player. */
function run(host: SimHost, step: () => void, ids: readonly string[], from = 0, ticks = TICKS): { frames: Frame[][]; hits: Hit[] } {
  const frames: Frame[][] = [], hits: Hit[] = [];
  let tick = from;
  host.events.on('damage.dealt', ({ req, dealt }) => { hits.push({ tick, amount: dealt, tags: req.sourceTags }); }, host.scope);
  for (; tick < from + ticks; tick++) { hold(host, tick); step(); frames.push(ids.map(id => frame(host, id))); }
  return { frames, hits };
}
/** The keeper's ray and strider as declared spawns: each body the keeper drew (scale, pose, circle phase). */
function spawnsFrom(host: SimHost): Spawn[] {
  return [RAY, STRIDER].map((id, index) => {
    const actor = host.entities.get(id), species = rows.rows.species.find(row => row.kind === actor?.kind);
    const brain = rows.program.species.find(row => row.kind === actor?.kind)?.brain;
    if (actor === undefined || species === undefined) throw new Error(`Missing keeper body ${id}`);
    return { id, species: species.id, variant: 'dusk', brain: species.temperament?.brain ?? null, strike: null, seed: 11 + index,
      scale: actor.scale, at: [actor.position.x, actor.position.y, actor.position.z], yaw: actor.yaw,
      ...(brain !== undefined && 'phaseSlots' in brain ? { phaseOffset: seedSlot(actor.seed, brain.phaseSlots) } : {}) } as Spawn;
  });
}

test('Dunes ray and strider run on the native resident as declared rows tick for tick as its keeper, and save and restore', async () => {
  const fixture = await dunes();
  // the keeper: the plan's own population with the ray and strider homes and the boss, one step before it installs (the
  // keeper decides on ticks 1 mod 6, the declared brains on 0 mod 6, as in the OF11b parity)
  // at OF11b's stands, in the player's near band: the declared host thinks a far body at its banded rate (`installDataCreatureBands`)
  const kept = keeping(fixture.plan, [RAY, STRIDER]), stands = new Map<string, [number, number]>([[RAY, [8, -75]], [STRIDER, [10, -50]]]);
  const program = { ...kept, recipe: { ...kept.recipe, population: { ...kept.recipe.population, rows: { ...kept.recipe.population.rows,
    homes: kept.recipe.population.rows.homes.map(home => ({ ...home, at: stands.get(home.id) ?? home.at })) } } } };
  const world = await prepareRuntimeWorld(fixture.shard, fixture.assets, program.baked, program.recipe, fixture.sections);
  const keeper = createSimHost(world.level, { ...world.ports, rapier: fixture.rapier });
  keeper.step(); world.install(keeper, { restoring: false, emit: () => undefined }).keeper.settle();
  // the resident: the keeper cut to its boss, the ray and strider as declared spawns
  const cell = input(fixture, declaring(fixture.shard, rows.rows.species, spawnsFrom(keeper)), keeping(fixture.plan, []), MATRIARCH);
  const resident = await createNativeHeadlessResident(cell);
  let restored: Awaited<ReturnType<typeof createNativeHeadlessResident>> | undefined;
  try {
    for (const id of [RAY, STRIDER]) expect(frame(resident.host, id)).toEqual(frame(keeper, id));
    expect(resident.host.entities.get(RAY)?.species).toBe('sunscar.creature.duneRay');
    const a = run(keeper, () => { keeper.step(); }, [RAY, STRIDER]), b = run(resident.host, () => { resident.step([]); }, [RAY, STRIDER]);
    const moved = (i: number): number => { const s = a.frames[0]?.[i], e = a.frames[TICKS - 1]?.[i]; return s === undefined || e === undefined ? 0 : Math.hypot(e.x - s.x, e.z - s.z); };
    expect(moved(0)).toBeGreaterThan(5); expect(moved(1)).toBeGreaterThan(2);
    expect(a.hits.length).toBeGreaterThan(0);
    let worst = { d: 0, tick: -1, body: -1 };
    for (let tick = 0; tick < TICKS; tick++) for (let i = 0; i < 2; i++) {
      const p = a.frames[tick]?.[i], q = b.frames[tick]?.[i]; if (p === undefined || q === undefined) throw new Error('Missing frame');
      const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z); if (d > worst.d) worst = { d, tick, body: i };
    }
    expect(worst.d, JSON.stringify(worst)).toBeLessThan(0.01);
    expect(b.frames.map(row => row.map(f => [f.attack, f.state]))).toEqual(a.frames.map(row => row.map(f => [f.attack, f.state])));
    expect(b.hits.map(({ tick, amount }) => ({ tick, amount }))).toEqual(a.hits.map(({ tick, amount }) => ({ tick, amount })));
    // a save mid-fight restores the declared bodies, their brains and clocks exactly, and both go on the same
    restored = await createNativeHeadlessResident(cell, serializeSimSnapshot(snapshotSimHostBytes(resident.host)));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(resident.host)));
    const live = resident, again = restored;
    const c = run(live.host, () => { live.step([]); }, [RAY, STRIDER], TICKS, 300), d = run(again.host, () => { again.step([]); }, [RAY, STRIDER], TICKS, 300);
    expect(d).toEqual(c);
    expect(canonicalSimDigest(snapshotSimHost(again.host))).toBe(canonicalSimDigest(snapshotSimHost(live.host)));
  } finally { restored?.dispose(); resident.dispose(); keeper.dispose(); }
}, 120_000);

const savedPolicy = v.object({ phase: v.number(), fighting: v.boolean() });
test('the Matriarch stays the keeper\'s beside declared spawns, and a body or decision row both owners claim refuses', async () => {
  const fixture = await dunes(), boss = keeping(fixture.plan, []);
  const at = (x: number, z: number): [number, number, number] => [x, 0, z];
  const spawns = [{ id: RAY, at: at(8, -75) }, { id: STRIDER, at: at(10, -50) }].map(({ id, at: point }, index) => {
    const species = rows.rows.species[index]; if (species === undefined) throw new Error('Missing converted species');
    return { id, species: species.id, variant: 'dusk', brain: species.temperament?.brain ?? null, strike: null, seed: 11 + index, scale: 1, at: point, yaw: 0,
      ...(species.kind === 'duneStrider' ? { phaseOffset: 0 } : {}) } as Spawn; });
  const shard = declaring(fixture.shard, rows.rows.species, spawns), cell = input(fixture, shard, boss, MATRIARCH);
  const world = await prepareRuntimeWorld(shard, fixture.assets, boss.baked, boss.recipe, cell.sections);
  const host = createSimHost(world.level, { ...world.ports, rapier: fixture.rapier });
  try {
    const environment = world.install(host, { restoring: false, emit: () => undefined }); environment.keeper.settle();
    host.events.answer('damage.modify', request => request?.target === leadPlayer(host).health ? null : request, host.scope);
    // summoned, the keeper's Matriarch rises and fights on her borrowed decision row while the declared bodies stand by
    leadPlayer(host).position.set(-14, 0.1, -141); environment.encounter.summon();
    for (let i = 0; i < 600; i++) host.step();
    const slot = snapshotSimHost(host).adapters.find(row => row.id === 'sunscar.homes');
    const kept = v.parse(v.object({ boss: v.object({ policy: v.string() }) }), slot?.state), wire: unknown = JSON.parse(kept.boss.policy);
    expect(typeof wire === 'string' ? v.parse(savedPolicy, JSON.parse(wire)) : null).toMatchObject({ fighting: true });
    expect(host.entities.get('sunscar.matriarch')?.position.y).toBeGreaterThan(4);
    expect([RAY, STRIDER].map(id => host.entities.get(id)?.alive)).toEqual([true, true]);
  } finally { host.dispose(); }
  // the keeper standing the ray's home claims that body; standing a skitterer home claims the pack's decision row, which
  // names a declared body
  await expect(createNativeHeadlessResident(input(fixture, shard, keeping(fixture.plan, [RAY]), MATRIARCH))).rejects.toThrow(/one body, one owner/u);
  const pack = declaring(fixture.shard, rows.rows.species, spawns.map((row, index) => index === 0 ? { ...row, id: 'sunscar.home:2' } : row));
  await expect(createNativeHeadlessResident(input(fixture, pack, keeping(fixture.plan, ['sunscar.home:1'])))).rejects.toThrow(/one decision row, one owner/u);
}, 120_000);

test('a runtime plan with no declared spawn stands no body and installs no declared step', async () => {
  const fixture = await dunes();
  const world = await prepareRuntimeWorld(fixture.shard, fixture.assets, fixture.plan.baked, fixture.plan.recipe, fixture.sections);
  expect(world.level.entities).toEqual([]);
  const host = createSimHost(world.level, { ...world.ports, rapier: fixture.rapier });
  try {
    world.install(host, { restoring: false, emit: () => undefined }).keeper.settle();
    const saved = snapshotSimHost(host), restored = restoreSimHost(world.level, { ...world.ports, rapier: fixture.rapier }, saved, fresh => {
      world.install(fresh, { restoring: true, emit: () => undefined, snapshot: saved }).keeper.settle(); });
    try { expect(canonicalSimDigest(snapshotSimHost(restored))).toBe(canonicalSimDigest(saved)); } finally { restored.dispose(); }
  } finally { host.dispose(); }
}, 60_000);
