// oxlint-disable-next-line import/no-nodejs-modules -- The worker journey runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { openWorldAdapter, type WorldAdapter } from '../src/server/host/openWorld';
import { runHeadlessJourney } from '../src/shared/host/headlessJourney';
import { compileProductWorker } from './fixtures/headless/compileProductWorker';
import { productHeadlessSections } from '../src/shared/host/headlessSections';
import { decodeSimSnapshot, serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { canonicalSimDigest } from './fake/simState';
import { builtProduct } from './fixtures/builtProduct';

// P1-E3.1b: Nalati Grasslands' worker runs the same world as a resident, from its built product alone. FAST-SLOW-TESTS
// FS1: this case moved here unchanged from nalati-headless-population.test.ts as it stood before FAST-SLOW-TESTS (the
// sequential original, not the overlapped interim); the population story runs on its own. SERVER-PARITY HS1: the worker ticks
// the room's world (`openWorldAdapter`), so its twin here is that world too.

const SLUG = 'nalati-grasslands';

async function shipped(): Promise<{ directory: string; product: Awaited<ReturnType<typeof loadHeadlessProduct>>; assets: Map<string, Uint8Array>; rapier: Rapier; resident: (snapshot?: string) => Promise<WorldAdapter> }> {
  const directory = builtProduct(SLUG), product = await loadHeadlessProduct(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error(`Missing admitted ${SLUG} output`);
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return { directory, product, assets, rapier, resident: snapshot => openWorldAdapter({ shard, assets, rapier, product }, snapshot) };
}
test('Nalati\'s worker runs the product\'s world: a route and its checkpoint match a resident exactly', async ({signal}) => {
  const { directory, product, assets, resident } = await shipped();
  const shard = product.shardfile, sections = productHeadlessSections(product), plan = { ticks: 240, points: [{ x: 0, z: 232 }, { x: 40, z: 180 }] };
  const options = { deadline: 'advisory' as const, product: directory, sections };
  // Fresh fixed code only: both workers still admit every original byte and own
  // independent worlds. Compilation and startup remain inside this case clock.
  const prepared = await compileProductWorker(undefined, signal);
  let worker: Awaited<ReturnType<typeof prepared.create>> | undefined;
  let second: Awaited<ReturnType<typeof prepared.create>> | undefined;
  let live: WorldAdapter | undefined;
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
