// oxlint-disable-next-line import/no-nodejs-modules -- The population journey runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parse } from 'valibot';
import { Vector3 } from 'three';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { createNativeHeadlessResident, type NativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { runHeadlessJourney } from '../src/shared/host/headlessJourney';
import { serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { FIXED_STEP } from '../src/shared/engine/core/fixedStep';
import { parseNativeRuntimePlan } from '@wildshard/format/nativeRuntimePlan';
import { ClientPopulationSchema } from '@wildshard/format/clientNative';
import { parseDecisionScripts } from '@wildshard/format/decisionScripts';
import { pagePopulationRows } from '../src/shared/game/population/pageRows';
import { bindPageHomes } from '../src/shared/game/population/pageHomes';
import { installPageReturns } from '../src/client/game/population/pageReturns';
import { populationCensus } from '../src/shared/game/population/census';
import { Scope } from '../src/shared/engine/app/scope';
import { legacyDouble } from '../src/test/engine/FakeGame';
import type { ShardContext } from '../src/client/game/plugin/context';
import type { ShardPlayHost, ShardRuntime } from '../src/shared/game/shard/runtime';
import { RowBodies } from '../src/client/engine/entities/RowBodies';
import { canonicalSimDigest } from '../src/test/engine/simState';
import { builtFolder } from '../src/test/game/builtFolder';

// P1-E3.1: population and creature spawning on the shipped headless host (`createNativeHeadlessResident`, the tick
// worker's own composition) for a real shard. Sunscar Dunes' homes keeper spawns, thinks, moves, kills and refills
// its creatures in the fixed tick; the census is their serialisable read model.

async function shipped(slug: string): Promise<{ resident: (snapshot?: string) => Promise<NativeHeadlessResident>; product: Awaited<ReturnType<typeof loadHeadlessFolder>> }> {
  const directory = builtFolder(slug), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error(`Missing admitted ${slug} output`);
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier: Rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return { product, resident: snapshot => createNativeHeadlessResident({ shard, assets, rapier, product }, snapshot) };
}
const kill = (resident: NativeHeadlessResident, id: string): void => {
  const actor = resident.host.entities.get(id);
  if (actor === undefined || !actor.alive) throw new Error(`No live creature ${id}`);
  const dealt = resident.host.combat.hit({ source: 'env', sourceTags: ['dmg.legacy', 'cover.checked'], target: actor.combatActor(),
    amount: actor.maxHp * 10, point: actor.position.clone(), dir: new Vector3(0, 0, 1) });
  if (dealt?.killed !== true) throw new Error(`Creature ${id} did not fall`);
};
const steps = (resident: NativeHeadlessResident, ticks: number): void => { for (let i = 0; i < ticks; i++) resident.step([]); };

// ONE-FORMAT OF19b (Dunes rev 4): the homes left the keeper for declared spawns, which refill by their spawn rows'
// `respawn`; the census counts them as bodies (the keeper's `homes` are the page's, now none).
test('Sunscar spawns, moves, kills and refills its creatures headless, and its census round-trips a snapshot', async () => {
  const { product, resident } = await shipped('sunscar-dunes');
  const browser = pagePopulationRows(parseNativeRuntimePlan(product.section('sim/runtime-plan')));
  const spawns = product.shardfile.creatures.spawns;
  const live = await resident();
  let restored: NativeHeadlessResident | undefined;
  try {
    // spawning: the install stands every declared spawn; the keeper, like the browser's page population, keeps no home
    const born = populationCensus(live.host);
    expect(born.homes.map(row => [row.id, row.kind])).toEqual(browser.homes.map(row => [row.id, row.kind]));
    expect(born.homes).toEqual([]);
    expect(born.bodies.map(body => body.id).sort()).toEqual(spawns.map(row => row.id).sort());
    expect(born.kinds).toEqual({ duneRay: { alive: 1, fallen: 0 }, sandSkitterer: { alive: 10, fallen: 0 }, duneStrider: { alive: 2, fallen: 0 } });
    const wire = JSON.stringify(born); // plain JSON: no live body, vector or clock
    expect(JSON.parse(wire)).toEqual(born);

    // AI: walk the player at the western skitterer nest; the population moves on the fixed tick
    const journey = runHeadlessJourney(live.host, input => { live.step(input); }, { ticks: 900, points: [{ x: 0, z: 0 }, { x: -20, z: 6 }] });
    expect(journey.ticks).toBe(900);
    const walked = populationCensus(live.host), was = new Map(born.bodies.map(body => [body.id, body]));
    const moved = walked.bodies.filter(body => { const before = was.get(body.id); return before !== undefined
      && Math.hypot(body.position[0] - before.position[0], body.position[2] - before.position[2]) > 1; }).map(body => body.id);
    expect(moved.length).toBeGreaterThanOrEqual(3);

    // respawn: a fallen skitterer's spawn row waits its 50 s, then a fresh body stands in it
    const respawn = spawns.find(row => row.id === 'sunscar.home:4')?.respawn;
    expect(respawn).toBe(50);
    kill(live, 'sunscar.home:4');
    steps(live, 1);
    const fallen = populationCensus(live.host);
    expect(fallen.kinds['sandSkitterer']?.fallen).toBe(1);
    steps(live, 600);
    const waiting = populationCensus(live.host);
    expect(waiting.bodies.find(body => body.id === 'sunscar.home:4')?.alive).toBe(false);

    // snapshot → restore mid-countdown: the census (bodies, poses) and the canonical state come back exactly
    restored = await resident(serializeSimSnapshot(snapshotSimHostBytes(live.host)));
    expect(populationCensus(restored.host)).toEqual(waiting);
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(live.host)));
    for (let tick = 0; tick < 2520; tick++) { live.step([]); restored.step([]); }
    const refilled = populationCensus(live.host);
    expect(populationCensus(restored.host)).toEqual(refilled);
    expect(refilled.bodies.find(body => body.id === 'sunscar.home:4')?.alive).toBe(true);
  } finally { restored?.dispose(); live.dispose(); }
}, 120_000);

test('the browser page population is the server\'s: a herdless page holds no home body and never listens for a death', async () => {
  // SR12: the page's RowBodies is herdless, so its homes spawn nothing and match no death. The headless keeper above
  // refills Sunscar on its own; the page only draws the rows it sends (flow:creature-returns).
  const { product, resident } = await shipped('sunscar-dunes');
  const declared = pagePopulationRows(parseNativeRuntimePlan(product.section('sim/runtime-plan')));
  const feature = product.section('client/plan').features.find(row => row.kind === 'population.homes');
  if (feature === undefined) throw new Error('Sunscar declares its page population');
  const row = parse(ClientPopulationSchema, feature);
  const subscribed: string[] = [], systems: Parameters<ShardContext['system']>[0][] = [], spawned: string[] = [], prepared: string[] = [];
  // The page's own manager, RowBodies: its draw reduced to the factory a herdless page prepares models through.
  const rowBodies = new RowBodies(legacyDouble<ConstructorParameters<typeof RowBodies>[0]>({
    factory: legacyDouble<RowBodies['factory']>({ prepareSteps: function* (rows: readonly { kind: string }[]) { for (const entry of rows) { prepared.push(entry.kind); yield prepared.length; } } }) }),
    legacyDouble<ConstructorParameters<typeof RowBodies>[1]>({ levelScope: null }));
  rowBodies.spawn = kind => { spawned.push(kind); throw new Error('A herdless page spawns no body'); };
  const scope = new Scope('sr12.page.homes');
  const ctx = legacyDouble<ShardContext>({ scope,
    game: legacyDouble<ShardContext['game']>({ runtime: legacyDouble<ShardRuntime>({ play: legacyDouble<ShardPlayHost>({ animals: rowBodies }) }) }),
    on: name => { subscribed.push(name); },
    system: spec => { systems.push(spec); } });
  const page = bindPageHomes(ctx, declared, { system: row.system,
    decisionActors: parseDecisionScripts(product.section('sim/scripts')).filter(script => 'spawnGroup' in script.binding).flatMap(script => Object.values(script.actors)),
    ...(row.holds === undefined ? {} : { holds: { ...row.holds, flags: { has: () => false } } }) });
  const live = await resident();
  try {
    live.step([]);
    // The page knows the server's homes by id and kind, and the server's keeper stands a body in each of them.
    const server = populationCensus(live.host);
    const byId = (rows: readonly { id: string; kind: string }[]): string[][] => rows.map(entry => [entry.id, entry.kind]).sort(([a = ''], [b = '']) => a < b ? -1 : a > b ? 1 : 0);
    expect(byId(page.homes)).toEqual(byId(server.homes));
    expect(server.homes.every(entry => entry.body !== null)).toBe(true);
    expect(rowBodies.herdless).toBe(true);
    expect(prepared.length).toBeGreaterThan(0);
    expect({ spawned, bodies: page.all().length, standing: page.homes.filter(entry => entry.animal !== null).length }).toEqual({ spawned: [], bodies: 0, standing: 0 });
    expect(subscribed).not.toContain('actor.died');
    for (let tick = 0; tick < 600; tick++) for (const system of systems) system.run(FIXED_STEP, 0);
    expect(page.homes.every(entry => entry.animal === null && entry.wait === 0)).toBe(true);
  } finally { live.dispose(); scope.dispose(); }
}, 120_000);

test('page actor returns refuse a page that makes its own bodies: the server returns them', () => {
  // SR12: installPageReturns no longer listens for deaths or refills; a page population with a herd of its own would be
  // left without returns, so it is refused before any program loads.
  const scope = new Scope('sr12.page.returns');
  const ctx = legacyDouble<ShardContext>({ scope, on: () => { throw new Error('No page return listens for a death'); },
    game: legacyDouble<ShardContext['game']>({ runtime: legacyDouble<ShardRuntime>({ world: legacyDouble<NonNullable<ShardRuntime['world']>>({}),
      play: legacyDouble<ShardPlayHost>({ animals: legacyDouble<ShardPlayHost['animals']>({ herdless: false }) }) }) }) });
  try {
    expect(() => installPageReturns(ctx, { step: 'sr12.page.returns', water: 0, fixed: [], program: null, outOfSight: 60, rules: {} })).toThrow('must be herdless');
  } finally { scope.dispose(); }
});

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
