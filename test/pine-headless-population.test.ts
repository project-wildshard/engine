// oxlint-disable-next-line import/no-nodejs-modules -- The population journey runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import * as v from 'valibot';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createTrustedHeadlessResident, type TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { HeadlessSimulation } from '../src/server/host/headless';
import { openWorldAdapter } from '../src/server/host/openWorld';
import { runHeadlessJourney } from '../src/shared/host/headlessJourney';
import { decodeSimSnapshot, serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { hasNativeAssembly } from '../src/server/game/shardfile/nativeAssembly';
import { populationCensus, type PopulationCensus } from '../src/shared/game/population/census';
import { encodeCanonicalJson } from '../src/shared/host/immutable';
import { canonicalSimDigest } from './fake/simState';
import { builtProduct } from './fixtures/builtProduct';
import { fencedNativeOracle } from './fixtures/native-oracle';
import { pineNativeOracleInputs } from './fixtures/pine-native-oracle-inputs';
import { pineNativeOracleSpec } from './fixtures/pine-native-oracle-spec';

// P1-E3.1b: Pine Hollow's world from the built product alone: the plan and its server-class files, with no terrain,
// navmesh or story lent by a fixture. The roster lands, lives, falls and answers the night in the fixed tick.

async function shipped() {
  const directory = builtProduct('pine-hollow'), product = await loadHeadlessProduct(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Missing admitted Pine output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return { directory, product, shard, assets, rapier, resident: (snapshot?: string) => createTrustedHeadlessResident({ shard, assets, rapier, product }, snapshot) };
}
const steps = (resident: TrustedHeadlessResident, ticks: number): void => { for (let i = 0; i < ticks; i++) resident.step([]); };
const variants = (census: PopulationCensus, ...names: string[]): string[] => census.bodies.filter(body => names.includes(body.variant)).map(body => body.variant).sort();

test('the product ships the facts the fixture lent, as server files only', async () => {
  const { product, shard } = await shipped(), oracle = await fencedNativeOracle(pineNativeOracleSpec(), pineNativeOracleInputs);
  expect(hasNativeAssembly(product)).toBe(true);
  const text = async (name: string): Promise<string> => new TextDecoder().decode(await product.file(name));
  expect(await text('server/habitat.json')).toBe(encodeCanonicalJson(oracle.environment));
  expect((await product.file('server/terrain.bin')).byteLength).toBe(537_984);
  expect((await product.file('server/navmesh.bin')).byteLength).toBe(171_456);
  const index = outputDescriptor(shard)?.index, server = index?.admission.server ?? [];
  expect(server.map(row => row.name)).toEqual(['server/habitat.json', 'server/native-assembly.json', 'server/navmesh.bin', 'server/quest-policy.json', 'server/terrain.bin']);
  const client = new Set([...index?.files.map(file => file.hash) ?? [], ...(index?.packs ?? []).flatMap(pack => pack.entries.map(entry => entry.hash))]);
  expect(server.filter(row => client.has(row.hash))).toEqual([]);
}, 120_000);

test('Pine lands, moves, loses and fills out its population headless, and its census round-trips a snapshot', async () => {
  const { product, resident } = await shipped();
  const roster = v.parse(v.looseObject({ bodyCount: v.number() }), await product.json('actors/roster.json'));
  const live = await resident();
  let restored: TrustedHeadlessResident | undefined;
  try {
    // spawning: the install draws the declared roster and nothing else; the night and the elites come later
    const born = populationCensus(live.host);
    expect(born.alive).toBe(roster.bodyCount);
    expect(born.kinds).toEqual({ deer: { alive: 91, fallen: 0 }, elk: { alive: 23, fallen: 0 }, boar: { alive: 46, fallen: 0 }, bear: { alive: 4, fallen: 0 } });
    expect(born.bodies.every(body => body.alive && body.id.startsWith('creature:'))).toBe(true);
    expect(born.homes).toEqual([]);
    const wire = JSON.stringify(born); // plain JSON: no live body, vector or clock
    expect(JSON.parse(wire)).toEqual(born);

    // AI: walk the player at the eastern herd; the population moves and notices on the fixed tick
    const journey = runHeadlessJourney(live.host, input => { live.step(input); }, { ticks: 900, points: [{ x: 0, z: -235 }, { x: 97, z: -219 }] });
    expect(journey.ticks).toBe(900);
    const walked = populationCensus(live.host), was = new Map(born.bodies.map(body => [body.id, body]));
    const moved = walked.bodies.filter(body => { const before = was.get(body.id); return before !== undefined
      && Math.hypot(body.position[0] - before.position[0], body.position[2] - before.position[2]) > 1; });
    expect(moved.length).toBeGreaterThanOrEqual(10);
    expect(walked.bodies.map(body => body.state)).toEqual(expect.arrayContaining(['graze', 'wander', 'alert']));

    // a kill: the body stays counted as fallen, its kind's living count drops
    const victim = live.host.entities.get('creature:11');
    if (victim === undefined) throw new Error('Missing the herd stag');
    const dealt = live.host.combat.hit({ source: 'env', sourceTags: ['dmg.legacy', 'cover.checked'], target: victim.combatActor(), amount: victim.maxHp * 10, point: victim.position.clone(), dir: new Vector3(0, 0, 1) });
    expect(dealt?.killed).toBe(true);
    steps(live, 1);
    const fallen = populationCensus(live.host);
    expect(fallen.kinds['deer']).toEqual({ alive: 90, fallen: 1 });

    // the night: the elites walk at dusk and the spawn script's thralls join them
    await live.host.dayClock?.set(0.9);
    steps(live, 300);
    const night = populationCensus(live.host);
    expect(night.alive).toBeGreaterThan(fallen.alive);
    expect(variants(night, 'thrall')).toEqual(['thrall', 'thrall', 'thrall']);
    expect(variants(night, 'ghost', 'imperial', 'ironhide')).toEqual(['ghost', 'imperial', 'ironhide']);

    // snapshot → restore at night: bodies, poses and canonical state come back exactly, then both carry on as one
    restored = await resident(serializeSimSnapshot(snapshotSimHostBytes(live.host)));
    expect(populationCensus(restored.host)).toEqual(night);
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(live.host)));
    for (let tick = 0; tick < 600; tick++) { live.step([]); restored.step([]); }
    expect(populationCensus(restored.host)).toEqual(populationCensus(live.host));
  } finally { restored?.dispose(); live.dispose(); }
}, 120_000);

// SERVER-PARITY HS1: the worker ticks the room's world (`openWorldAdapter`), so its twin here is that world too
test('the tick worker runs Pine from its built product: the same world, and it resumes from its own checkpoint', async () => {
  const { directory, shard, assets, product, rapier } = await shipped(), options = { deadline: 'advisory', product: directory } as const;
  const twin = await openWorldAdapter({ shard, assets, rapier, product }), worker = await HeadlessSimulation.create(shard, assets, undefined, options);
  try {
    const start = canonicalSimDigest(snapshotSimHost(twin.host)), input = [{ kind: 'player' as const, moveX: 0.6, moveZ: -0.8, yaw: 0 }];
    let tick = 0;
    for (; tick < 120; tick++) { await worker.step([{ source: 'player', commands: input }]); twin.step(input); }
    const commit = worker.checkpoint;
    if (commit === undefined) throw new Error('Missing worker checkpoint');
    expect(commit.tick).toBe(tick);
    const moved = canonicalSimDigest(snapshotSimHost(twin.host));
    expect(moved).not.toBe(start);
    expect(canonicalSimDigest(decodeSimSnapshot(commit.snapshot))).toBe(moved);
    const resumed = await HeadlessSimulation.create(shard, assets, commit.snapshot, options);
    try {
      for (let at = 0; at < 60; at++) { await worker.step(); await resumed.step(); twin.step([]); }
      const end = resumed.checkpoint;
      if (end === undefined) throw new Error('Missing resumed checkpoint');
      expect(canonicalSimDigest(decodeSimSnapshot(end.snapshot))).toBe(canonicalSimDigest(snapshotSimHost(twin.host)));
    } finally { await resumed.dispose(); }
  } finally { await worker.dispose(); twin.dispose(); }
}, 360_000);
