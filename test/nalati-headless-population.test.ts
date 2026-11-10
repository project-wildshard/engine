// oxlint-disable-next-line import/no-nodejs-modules -- The population journey runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import * as v from 'valibot';
import { Vector3 } from 'three';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { createTrustedHeadlessResident, type TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { runHeadlessJourney } from '../src/shared/host/headlessJourney';
import { compileProductWorker } from './fixtures/headless/compileProductWorker';
import { productHeadlessSections } from '../src/shared/host/headlessSections';
import { decodeSimSnapshot, serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { populationCensus, type PopulationCensus } from '../src/shared/game/population/census';
import { NATIVE_ASSEMBLY_FILE } from '@wildshard/format/nativeAssembly';
import { canonicalSimDigest } from './fake/simState';
import { builtProduct } from './fixtures/builtProduct';
import { jumpOwnerClock } from './fixtures/ownerClock';

// P1-E3.1b: Nalati Grasslands' population on the shipped headless host, from its built product alone. The world's every
// server input is a server-class file (J91); no test fixture lends a row, and the worker runs the same world as a resident.

const SLUG = 'nalati-grasslands', Roster = v.looseObject({ roster: v.looseObject({ bodies: v.array(v.looseObject({ id: v.string(), kind: v.string(), variant: v.looseObject({ id: v.string() }) })) }) });

async function shipped(): Promise<{ directory: string; product: Awaited<ReturnType<typeof loadHeadlessProduct>>; assets: Map<string, Uint8Array>; rapier: Rapier; resident: (snapshot?: string) => Promise<TrustedHeadlessResident> }> {
  const directory = builtProduct(SLUG), product = await loadHeadlessProduct(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error(`Missing admitted ${SLUG} output`);
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return { directory, product, assets, rapier, resident: snapshot => createTrustedHeadlessResident({ shard, assets, rapier, product }, snapshot) };
}
const Raid = v.looseObject({ state: v.looseObject({ raidT: v.number(), spawned: v.number() }) });
const steps = (resident: TrustedHeadlessResident, ticks: number): void => { for (let i = 0; i < ticks; i++) resident.step([]); };
const byId = (census: PopulationCensus, id: string): PopulationCensus['bodies'][number] => {
  const body = census.bodies.find(row => row.id === id); if (body === undefined) throw new Error(`Missing census body ${id}`); return body;
};
const kill = (resident: TrustedHeadlessResident, id: string): void => {
  const actor = resident.host.entities.get(id);
  if (actor === undefined || !actor.alive) throw new Error(`No live creature ${id}`);
  const dealt = resident.host.combat.hit({ source: 'env', sourceTags: ['dmg.legacy', 'cover.checked'], target: actor.combatActor(),
    amount: actor.maxHp * 10, point: actor.position.clone(), dir: new Vector3(0, 0, 1) });
  if (dealt?.killed !== true) throw new Error(`Creature ${id} did not fall`);
};

test('Nalati runs its whole population headless from the product: roster, wolves, night, a raid and a snapshot', async () => {
  const { product, resident } = await shipped();
  expect(product.hasFile(NATIVE_ASSEMBLY_FILE)).toBe(true);
  const roster = v.parse(Roster, await product.json('server/boot.json')).roster.bodies;
  const live = await resident();
  let restored: TrustedHeadlessResident | undefined;
  try {
    // spawning: the install stands every declared body, in place of the direct fixture's rows
    const born = populationCensus(live.host);
    const identity = (rows: readonly (readonly [string, string, string])[]): string[] => rows.map(row => row.join(':')).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    expect(identity(born.bodies.map(body => [body.id, body.kind, body.variant]))).toEqual(identity(roster.map(body => [body.id, body.kind, body.variant.id])));
    expect(born.kinds).toEqual({ wolf: { alive: 5, fallen: 0 }, horse: { alive: 27, fallen: 0 }, sheepdog: { alive: 1, fallen: 0 }, leopard: { alive: 1, fallen: 0 }, argymaq: { alive: 1, fallen: 0 } });
    expect(born.bodies.every(body => body.state === 'idle' && body.alive)).toBe(true);
    expect(structuredClone(born)).toEqual(born);
    // every saved owner the plan installs, so a host left out fails here
    expect([...live.host.adapters.keys()].filter(id => !id.startsWith('runtime.actor.')).sort((a, b) => a < b ? -1 : a > b ? 1 : 0)).toEqual(['nalati.creatures', 'nalati.elites', 'nalati.mounted', 'nalati.raid', 'nalati.taming', 'nalati.trample', 'nalati.weather']);

    // AI: stand the player by the den; the pack stalks him, and the dog keeps its own round on the fixed tick
    const journey = runHeadlessJourney(live.host, input => { live.step(input); }, { ticks: 900, start: { x: -125, z: 95, yaw: 0 }, points: [{ x: -125, z: 95 }, { x: -140, z: 90 }] });
    expect(journey.final.tick).toBeGreaterThan(900);
    const stalked = populationCensus(live.host), was = new Map(born.bodies.map(body => [body.id, body]));
    expect(stalked.bodies.filter(body => body.kind === 'wolf').map(body => body.state)).toEqual(Array.from({ length: 5 }, () => 'stalk'));
    const moved = stalked.bodies.filter(body => { const before = was.get(body.id); return before !== undefined
      && Math.hypot(body.position[0] - before.position[0], body.position[2] - before.position[2]) > 1; }).map(body => body.id);
    expect(moved).toEqual(expect.arrayContaining(['creature:0', 'creature:1', 'creature:2', 'creature:3', 'creature:4', 'creature:20']));

    // a fallen elite stays on the census until its keeper says otherwise
    kill(live, 'creature:25');
    const fallen = populationCensus(live.host);
    expect(fallen.kinds['leopard']).toEqual({ alive: 0, fallen: 1 });
    expect(fallen.alive).toBe(34);

    // night: the declared clock wakes Kokbori, its pack spawned around it
    await live.host.dayClock?.set(0.9);
    steps(live, 300);
    const night = populationCensus(live.host);
    expect(live.host.dayClock?.dayPhase).toBe('night');
    expect(night.kinds['kokbori']).toEqual({ alive: 1, fallen: 0 });
    expect(night.kinds['wolf']?.alive).toBe(10);
    expect(byId(night, 'creature:36').kind).toBe('kokbori');

    // snapshot → restore: the census (bodies, poses) and the canonical state come back exactly, and carry on together
    restored = await resident(serializeSimSnapshot(snapshotSimHostBytes(live.host)));
    expect(populationCensus(restored.host)).toEqual(night);
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(live.host)));
    for (let tick = 0; tick < 1200; tick++) { live.step([]); restored.step([]); }
    expect(populationCensus(restored.host)).toEqual(populationCensus(live.host));

    // the admission programme's delayed raid brings its three raiders at the flock. FAST-SLOW-TESTS FS1: the raid was
    // 121.7 s (7,300 ticks) away here and the original stepped 18,000 idle ticks to reach it. Its saved countdown jumps
    // to one second, so the programme's own raid tick still runs the countdown out, admits the raid and spawns the pack.
    const due = jumpOwnerClock(live.host, 'nalati.raid', ['state.raidT'], state => v.parse(Raid, state), state => {
      expect(state.state.spawned).toBe(0); expect(state.state.raidT).toBeGreaterThan(60);
      return { ...state, state: { ...state.state, raidT: 1 } };
    });
    expect(due.state.raidT).toBe(1);
    steps(live, 600);
    const raided = populationCensus(live.host);
    expect(raided.kinds['wolf']?.alive).toBe(13);
    expect(['creature:42', 'creature:43', 'creature:44'].map(id => byId(raided, id).kind)).toEqual(['wolf', 'wolf', 'wolf']);
    // the programme spawned them, once, from the jumped countdown
    expect(v.parse(Raid, live.host.adapters.get('nalati.raid')?.snapshot()).state.spawned).toBe(1);
  } finally { restored?.dispose(); live.dispose(); }
}, 180_000);

test('Nalati\'s worker runs the product\'s world: a route and its checkpoint match a resident exactly', async ({signal}) => {
  const { directory, product, assets, resident } = await shipped();
  const shard = product.shardfile, sections = productHeadlessSections(product), plan = { ticks: 240, points: [{ x: 0, z: 232 }, { x: 40, z: 180 }] };
  const options = { deadline: 'advisory' as const, product: directory, sections };
  // Fresh fixed code only: both workers still admit every original byte and own
  // independent worlds. Compilation and startup remain inside this case clock.
  const prepared = await compileProductWorker(undefined, signal);
  let worker: Awaited<ReturnType<typeof prepared.create>> | undefined;
  let second: Awaited<ReturnType<typeof prepared.create>> | undefined;
  let live: TrustedHeadlessResident | undefined;
  try {
    worker = await prepared.create(shard, assets, undefined, options);
    live = await resident();
    const current = live;
    const walked = await worker.walkLeg(plan), expected = runHeadlessJourney(current.host, input => { current.step(input); }, plan);
    expect(walked.final).toEqual(expected.final);
    const saved = worker.checkpoint;
    if (saved === undefined) throw new Error('The worker kept no checkpoint');
    expect(saved.tick).toBe(live.host.state.tick);
    // the worker's world: every roster body, on its own clock, and exactly the resident's
    expect(saved.snapshot).toBe(serializeSimSnapshot(snapshotSimHostBytes(live.host)));
    expect(canonicalSimDigest(decodeSimSnapshot(saved.snapshot))).toBe(canonicalSimDigest(snapshotSimHost(live.host)));
    expect([...live.host.entities.keys()].filter(id => id.startsWith('creature:'))).toHaveLength(35);

    // a second worker carries on from that checkpoint: a restore is the same world
    second = await prepared.create(shard, assets, saved.snapshot, options);
    const commit = await second.step([]);
    live.step([]);
    expect(commit.tick).toBe(saved.tick + 1);
    expect(commit.snapshot).toBe(serializeSimSnapshot(snapshotSimHostBytes(live.host)));
  } finally {
    try { live?.dispose(); await second?.dispose(); await worker?.dispose(); }
    finally { prepared.dispose(); }
  }
}, 120_000);
