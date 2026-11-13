// oxlint-disable-next-line import/no-nodejs-modules -- The population journey runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import * as v from 'valibot';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createTrustedHeadlessResident, type TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { HeadlessSimulation } from '../src/server/host/headless';
import { openWorldAdapter, type WorldAdapter } from '../src/server/host/openWorld';
import { runHeadlessJourney } from '../src/shared/host/headlessJourney';
import { serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { populationCensus } from '../src/shared/game/population/census';
import { canonicalSimDigest } from './fake/simState';
import { builtProduct } from './fixtures/builtProduct';

// P1-E3.1b: Driftwood's population on the shipped headless host, from its built product and nothing else: the plan and
// rows under server/, no fixture and no overlay.

const SLUG = 'driftwood-isle', PRACTICE = 'creature:21';
const Keeper = v.object({ bodies: v.array(v.object({ id: v.string(), kind: v.string(), variant: v.string(), practice: v.boolean() })) });

async function shipped() {
  const directory = builtProduct(SLUG), product = await loadHeadlessProduct(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error(`Missing admitted ${SLUG} output`);
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return { directory, product, shard, assets, descriptor, rapier, resident: (snapshot?: string) => createTrustedHeadlessResident({ shard, assets, rapier, product }, snapshot) };
}
const kill = (resident: TrustedHeadlessResident, id: string): void => {
  const actor = resident.host.entities.get(id);
  if (actor === undefined || !actor.alive) throw new Error(`No live creature ${id}`);
  const dealt = resident.host.combat.hit({ source: 'env', sourceTags: ['dmg.legacy', 'cover.checked'], target: actor.combatActor(),
    amount: actor.maxHp * 10, point: actor.position.clone(), dir: new Vector3(0, 0, 1) });
  if (dealt?.killed !== true) throw new Error(`Creature ${id} did not fall`);
};
const steps = (resident: TrustedHeadlessResident, ticks: number): void => { for (let i = 0; i < ticks; i++) resident.step([]); };

test('Driftwood spawns, moves, kills and returns its mixed population headless, and its census round-trips a snapshot', async () => {
  const { product, resident } = await shipped(), keeper = v.parse(Keeper, await product.json('server/keeper.json'));
  const live = await resident();
  let restored: TrustedHeadlessResident | undefined;
  try {
    // spawning: every keeper row stands in the world, with the kinds and variants the product declares
    const born = populationCensus(live.host), rows = [...keeper.bodies].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    expect(born.bodies.map(body => [body.id, body.kind, body.variant])).toEqual(rows.map(row => [row.id, row.kind, row.variant]));
    expect(born.kinds).toEqual({ boar: { alive: 11, fallen: 0 }, bear: { alive: 2, fallen: 0 }, crab: { alive: 9, fallen: 0 }, monkey: { alive: 11, fallen: 0 }, sailor: { alive: 1, fallen: 0 } });
    expect(born.alive).toBe(34);
    expect(keeper.bodies.find(row => row.practice)?.id).toBe(PRACTICE);
    const wire = JSON.stringify(born); // plain JSON: no live body, vector or clock
    expect(JSON.parse(wire)).toEqual(born);

    // AI: walk the player at the eastern herd; the boars and the monkeys above them move on the fixed tick
    const journey = runHeadlessJourney(live.host, input => { live.step(input); }, { ticks: 900, points: [{ x: 0, z: -194 }, { x: 60, z: -130 }] });
    expect(journey.ticks).toBe(900);
    const walked = populationCensus(live.host), was = new Map(born.bodies.map(body => [body.id, body]));
    const moved = walked.bodies.filter(body => { const before = was.get(body.id); return before !== undefined
      && Math.hypot(body.position[0] - before.position[0], body.position[2] - before.position[2]) > 1; }).map(body => body.kind);
    expect(new Set(moved)).toEqual(new Set(['boar', 'bear', 'monkey']));
    expect(walked.bodies.some(body => body.state === 'perch')).toBe(true);

    // a fallen boar counts as fallen; its return is the keeper's, and it stays down for its 300 s minimum
    kill(live, 'creature:7');
    steps(live, 1);
    expect(populationCensus(live.host).kinds['boar']).toEqual({ alive: 10, fallen: 1 });

    // snapshot → restore mid-life: the census and the canonical state come back exactly and carry on identically
    restored = await resident(serializeSimSnapshot(snapshotSimHostBytes(live.host)));
    expect(populationCensus(restored.host)).toEqual(populationCensus(live.host));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(live.host)));

    // the practice crab returns after 45 s dead and 1.5 s fading, with the player over 30 m away
    kill(live, PRACTICE); kill(restored, PRACTICE);
    for (let tick = 0; tick < 2700; tick++) { live.step([]); restored.step([]); }
    expect(populationCensus(live.host).kinds['crab']).toEqual({ alive: 8, fallen: 1 });
    expect(populationCensus(restored.host)).toEqual(populationCensus(live.host));
    for (let tick = 0; tick < 120; tick++) { live.step([]); restored.step([]); }
    const returned = populationCensus(live.host);
    expect(returned.kinds['crab']).toEqual({ alive: 9, fallen: 0 });
    expect(returned.bodies.find(body => body.kind === 'crab' && body.position[2] < -100)?.alive).toBe(true);
    expect(populationCensus(restored.host)).toEqual(returned);
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(live.host)));
  } finally { restored?.dispose(); live.dispose(); }
}, 120_000);

// SERVER-PARITY HS1: the worker ticks the room's world (`openWorldAdapter`), so its twin on this thread is that world too
test('the worker runs Driftwood from its built product, tick for tick with the room\'s world', async () => {
  const { directory, shard, assets, product, rapier } = await shipped();
  // TS11 / FL23: the worker's start (its own thread loading ~530 source modules) is most of this case. The resident is
  // built and stepped on this thread meanwhile, instead of after it: the same two owners, inputs and ticks.
  const starting = HeadlessSimulation.create(shard, assets, undefined, { deadline: 'advisory', product: directory });
  starting.catch(() => undefined); // observed now; `await starting` below still throws its refusal
  let live: WorldAdapter | undefined;
  try {
    live = await openWorldAdapter({ shard, assets, rapier, product });
    const sim = await starting, commands = [{ kind: 'player' as const, moveX: 0.6, moveZ: 0.8, yaw: 0 }];
    const part = sim.verbTapePart({ version: 1, observe: [], segments: [{ id: 'same-300-inputs', ticks: 300, commands }] });
    part.catch(() => undefined); // awaited below; a throw on this thread first must not leave it unhandled
    await new Promise(resolve => { setImmediate(resolve); }); // let the tape request reach the worker before this thread steps
    for (let tick = 0; tick < 300; tick++) live.step(commands);
    const result = await part;
    expect(result.commit.tick).toBe(300);
    expect(result.commit.snapshot).toBe(serializeSimSnapshot(snapshotSimHostBytes(live.host)));
    expect(live.host.entities.size).toBe(34);
  } finally { await (await starting.catch(() => undefined))?.dispose(); live?.dispose(); }
}, 10_000); // Both owners still run every tick; only the final full continuation is asserted and published.

test("Driftwood's server files stay off every client path", async () => {
  const { descriptor, directory } = await shipped(), { admission, files, packs } = descriptor.index;
  const server = admission.server ?? [], names = server.map(row => row.name).sort();
  expect(names).toEqual(['server/keeper.json', 'server/kill-steps.json', 'server/mixed-population.json', 'server/native-assembly.json', 'server/physics.json',
    'server/quest-policy.json', 'server/quest-props.json', 'server/quest-spots.json', 'server/swords.json']);
  const shard: unknown = JSON.parse(readFileSync(`${directory}/shard.json`, 'utf8'));
  const hashes = new Set(server.map(row => row.hash)), listed = JSON.stringify([shard, packs], (key, value: unknown) => key === 'server' ? undefined : value);
  expect(files.filter(file => hashes.has(file.hash) || file.path.startsWith('server/') || file.name?.startsWith('server/') === true)).toEqual([]);
  for (const hash of hashes) expect(listed.includes(hash)).toBe(false);
});
