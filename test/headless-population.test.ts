// oxlint-disable-next-line import/no-nodejs-modules -- The population journey runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parse } from 'valibot';
import { Vector3 } from 'three';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { createTrustedHeadlessResident, type TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { runHeadlessJourney } from '../src/shared/host/headlessJourney';
import { serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { FIXED_STEP } from '../src/shared/engine/core/fixedStep';
import { parseNativeRuntimePlan } from '@wildshard/format/nativeRuntimePlan';
import { ClientPopulationSchema } from '@wildshard/format/clientNative';
import { parseDecisionScripts } from '@wildshard/format/decisionScripts';
import { pagePopulationRows } from '../src/shared/game/population/pageRows';
import { bindPageHomes } from '../src/shared/game/population/pageHomes';
import { censusOf, populationCensus, type PopulationCensus } from '../src/shared/game/population/census';
import { Scope } from '../src/shared/engine/app/scope';
import { legacyDouble } from '../src/test/engine/FakeGame';
import type { ShardContext } from '../src/client/game/plugin/context';
import type { ShardPlayHost, ShardRuntime } from '../src/shared/game/shard/runtime';
import type { AnimalManager } from '../src/server/engine/entities/AnimalManager';
import type { Animal } from '../src/client/engine/entities/AnimalView';
import type { Actor } from '../src/shared/engine/combat/pipeline';
import { canonicalSimDigest } from './fake/simState';
import { builtProduct } from './fixtures/builtProduct';

// P1-E3.1: population and creature spawning on the shipped headless host (`createTrustedHeadlessResident`, the tick
// worker's own composition) for a real shard. Sunscar Dunes' homes keeper spawns, thinks, moves, kills and refills
// its creatures in the fixed tick; the census is their serialisable read model.

async function shipped(slug: string): Promise<{ resident: (snapshot?: string) => Promise<TrustedHeadlessResident>; product: Awaited<ReturnType<typeof loadHeadlessProduct>> }> {
  const directory = builtProduct(slug), product = await loadHeadlessProduct(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error(`Missing admitted ${slug} output`);
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier: Rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return { product, resident: snapshot => createTrustedHeadlessResident({ shard, assets, rapier, product }, snapshot) };
}
const kill = (resident: TrustedHeadlessResident, id: string): void => {
  const actor = resident.host.entities.get(id);
  if (actor === undefined || !actor.alive) throw new Error(`No live creature ${id}`);
  const dealt = resident.host.combat.hit({ source: 'env', sourceTags: ['dmg.legacy', 'cover.checked'], target: actor.combatActor(),
    amount: actor.maxHp * 10, point: actor.position.clone(), dir: new Vector3(0, 0, 1) });
  if (dealt?.killed !== true) throw new Error(`Creature ${id} did not fall`);
};
const steps = (resident: TrustedHeadlessResident, ticks: number): void => { for (let i = 0; i < ticks; i++) resident.step([]); };
const home = (census: PopulationCensus, id: string): PopulationCensus['homes'][number] => {
  const row = census.homes.find(entry => entry.id === id); if (row === undefined) throw new Error(`Missing census home ${id}`); return row;
};

test('Sunscar spawns, moves, kills and refills its creatures headless, and its census round-trips a snapshot', async () => {
  const { product, resident } = await shipped('sunscar-dunes');
  const browser = pagePopulationRows(parseNativeRuntimePlan(product.section('sim/runtime-plan')));
  const live = await resident();
  let restored: TrustedHeadlessResident | undefined;
  try {
    // spawning: the install draws every declared home, exactly the rows the browser's page population spawns
    const born = populationCensus(live.host);
    expect(born.homes.map(row => [row.id, row.kind])).toEqual(browser.homes.map(row => [row.id, row.kind]));
    expect(born.bodies.map(body => body.id).sort()).toEqual(browser.homes.map(row => row.id).sort());
    expect(born.kinds).toEqual({ duneRay: { alive: 1, fallen: 0 }, sandSkitterer: { alive: 10, fallen: 0 }, duneStrider: { alive: 2, fallen: 0 } });
    expect(born.homes.every(row => row.body === row.id && row.wait === 0)).toBe(true);
    const wire = JSON.stringify(born); // plain JSON: no live body, vector or clock
    expect(JSON.parse(wire)).toEqual(born);

    // AI: walk the player at the western skitterer nest; the population moves on the fixed tick
    const journey = runHeadlessJourney(live.host, input => { live.step(input); }, { ticks: 900, points: [{ x: 0, z: 0 }, { x: -20, z: 6 }] });
    expect(journey.ticks).toBe(900);
    const walked = populationCensus(live.host), was = new Map(born.bodies.map(body => [body.id, body]));
    const moved = walked.bodies.filter(body => { const before = was.get(body.id); return before !== undefined
      && Math.hypot(body.position[0] - before.position[0], body.position[2] - before.position[2]) > 1; }).map(body => body.id);
    expect(moved.length).toBeGreaterThanOrEqual(3);
    // the nest's skitterers come at the player; the ray and the striders keep their own rounds
    expect(moved).toEqual(expect.arrayContaining(['sunscar.home:1', 'sunscar.home:3', 'sunscar.home:0', 'sunscar.home:11']));

    // respawn: a fallen skitterer's home waits its 50 s, then a fresh body stands in it
    kill(live, 'sunscar.home:4');
    // the host queues `actor.died` to its fixed.post drain: the keeper's clock starts at the end of the next tick
    expect(home(populationCensus(live.host), 'sunscar.home:4').wait).toBe(0);
    steps(live, 1);
    const fallen = populationCensus(live.host);
    expect(fallen.kinds['sandSkitterer']?.fallen).toBe(1);
    expect(home(fallen, 'sunscar.home:4').wait).toBe(50);
    steps(live, 600);
    const waiting = populationCensus(live.host);
    expect(home(waiting, 'sunscar.home:4').wait).toBeCloseTo(40, 6);

    // snapshot → restore mid-countdown: the census (bodies, poses, clocks) and the canonical state come back exactly
    restored = await resident(serializeSimSnapshot(snapshotSimHostBytes(live.host)));
    expect(populationCensus(restored.host)).toEqual(waiting);
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(live.host)));
    for (let tick = 0; tick < 2460; tick++) { live.step([]); restored.step([]); }
    const refilled = populationCensus(live.host);
    expect(populationCensus(restored.host)).toEqual(refilled);
    expect(home(refilled, 'sunscar.home:4')).toEqual({ id: 'sunscar.home:4', kind: 'sandSkitterer', body: 'sunscar.home:4', wait: 0 });
    expect(refilled.bodies.find(body => body.id === 'sunscar.home:4')?.alive).toBe(true);
  } finally { restored?.dispose(); live.dispose(); }
}, 120_000);

test('the browser page population counts and refills Sunscar exactly as the headless keeper does, tick for tick', async () => {
  const { product, resident } = await shipped('sunscar-dunes');
  const declared = pagePopulationRows(parseNativeRuntimePlan(product.section('sim/runtime-plan')));
  const feature = product.section('client/plan').features.find(row => row.kind === 'population.homes');
  if (feature === undefined) throw new Error('Sunscar declares its page population');
  const row = parse(ClientPopulationSchema, feature);
  // The page's creature manager, reduced to what its homes law reads: spawn, refill, retire and the died event.
  const animals: Animal[] = [], died: ((payload: unknown) => void)[] = [], systems: Parameters<ShardContext['system']>[0][] = [];
  let next = 0;
  const spawn = (kind: string, x: number, z: number, yaw: number, variant?: string | string[], placement?: { entityId?: string }): Animal => {
    const actor = legacyDouble<Actor>({}), position = new Vector3(x, 0, z);
    const animal = legacyDouble<Animal>({ entityId: placement?.entityId ?? `creature:${next++}`, kind, variant: typeof variant === 'string' ? variant : kind,
      alive: true, hp: 1, state: 'idle', yaw, position, mem: {}, combatActor: () => actor });
    animals.push(animal); return animal;
  };
  const manager = legacyDouble<AnimalManager>({ herdless: false, spawn, retire: animal => { const at = animals.indexOf(animal); if (at !== -1) animals.splice(at, 1); },
    replace: (retired, x, z, yaw, variant) => spawn(retired.kind, x, z, yaw, variant, { entityId: retired.entityId }) });
  const scope = new Scope('e3.1.page');
  const ctx = legacyDouble<ShardContext>({ scope,
    game: legacyDouble<ShardContext['game']>({ runtime: legacyDouble<ShardRuntime>({ play: legacyDouble<ShardPlayHost>({ animals: manager }) }) }),
    on: (name, fn) => { if (name === 'actor.died') died.push(fn as (payload: unknown) => void); },
    system: spec => { systems.push(spec); } });
  const page = bindPageHomes(ctx, declared, { system: row.system,
    decisionActors: parseDecisionScripts(product.section('sim/scripts')).filter(script => 'spawnGroup' in script.binding).flatMap(script => Object.values(script.actors)),
    ...(row.holds === undefined ? {} : { holds: { ...row.holds, flags: { has: () => false } } }) });
  const pageCensus = (tick: number): PopulationCensus => censusOf(tick, animals,
    page.homes.map(entry => ({ id: entry.id, kind: entry.kind, body: entry.animal?.entityId ?? null, wait: entry.wait })));
  // Bodies' identities and poses are each world's own; the count, the kinds and every home's clock are the population.
  const counted = (census: PopulationCensus) => ({ alive: census.alive, fallen: census.fallen, kinds: census.kinds,
    homes: census.homes.map(entry => ({ id: entry.id, kind: entry.kind, standing: entry.body !== null, wait: entry.wait })) });
  const live = await resident();
  try {
    // The page's events drain at phase boundaries like the host's: a death reaches the homes after the frame's systems.
    const pending: unknown[] = [];
    const frame = (): void => {
      live.step([]); for (const system of systems) system.run(FIXED_STEP, 0);
      for (const payload of pending.splice(0)) for (const listener of died) listener(payload);
    };
    expect(counted(pageCensus(live.host.state.tick))).toEqual(counted(populationCensus(live.host)));
    for (let tick = 0; tick < 120; tick++) frame();
    const killPage = (id: string): void => {
      const animal = page.homes.find(entry => entry.id === id)?.animal;
      if (animal === undefined || animal === null) throw new Error(`No page body in ${id}`);
      animal.alive = false; pending.push({ actor: animal.combatActor() });
    };
    kill(live, 'sunscar.home:7'); killPage('sunscar.home:7');
    kill(live, 'sunscar.home:11'); killPage('sunscar.home:11');
    let compared = 0;
    for (let tick = 0; tick < 4300; tick++) {
      frame();
      const server = counted(populationCensus(live.host)), client = counted(pageCensus(live.host.state.tick));
      if (JSON.stringify(client) !== JSON.stringify(server)) expect({ tick, client }).toEqual({ tick, client: server });
      compared++;
    }
    expect(compared).toBe(4300);
    const last = counted(populationCensus(live.host));
    expect(last.alive).toBe(13);
    expect(last.homes.every(entry => entry.standing && entry.wait === 0)).toBe(true);
  } finally { live.dispose(); scope.dispose(); }
}, 120_000);

test('Far Reach lands its held roster headless with the ids and kinds its browser page holds', async () => {
  const { product, resident } = await shipped('far-reach');
  const declared = pagePopulationRows(parseNativeRuntimePlan(product.section('sim/runtime-plan')));
  const live = await resident();
  try {
    live.step([]);
    const landed = populationCensus(live.host), page = [...declared.bosses, ...declared.actors ?? []];
    expect(landed.bodies.map(body => [body.id, body.kind])).toEqual(page.map(row => [row.id, row.kind]).sort(([a = ''], [b = '']) => a < b ? -1 : a > b ? 1 : 0));
    expect(landed.alive).toBe(page.length);
    expect(landed.homes.every(entry => entry.body === entry.id && entry.wait === 0)).toBe(true);
  } finally { live.dispose(); }
}, 120_000);
