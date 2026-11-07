// oxlint-disable-next-line import/no-nodejs-modules -- The journey runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import * as v from 'valibot';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { HeadlessJourneyPlanSchema } from '../src/shared/host/headlessJourney';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import type { TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { builtProduct } from './fixtures/builtProduct';
import { createNativeProofResident, prepareProductPlan } from './fixtures/headless-native';
import { installNativeWalkBounds } from './fixtures/headless/nativeBounds';
import { installWalkRopeBodies } from './fixtures/headless/ropeBodies';
import { physicsRoutes } from './fixtures/headless/physicsRoutes';
import { captureJourney, replayOnClient, type MotionCapture } from './fixtures/headless/motion-replay';

// P1-E5.3 B3, I1: a real Driftwood walk on the server, replayed on the client's step in a second world from the same product,
// and held to 2 cm and equal ground flags on every tick. It runs exact, rope bridge included.

const SLUG = 'driftwood-isle', LIMIT = .02;

test('a Driftwood journey replays on the client step', async () => {
  const directory = builtProduct(SLUG), product = await loadHeadlessProduct(directory), shard = product.shardfile, descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error(`Missing admitted ${SLUG} output`);
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  /** The world test/physics-headless.test.ts walks: the shipped plan, with the ruler's rope bodies and walk bounds. */
  const walkingResident = async (): Promise<TrustedHeadlessResident & { retire: () => void }> => {
    const resident = await createNativeProofResident({ shard, assets, rapier, product }, prepareProductPlan), retire = installWalkRopeBodies(resident.host, product);
    installNativeWalkBounds(resident.host);
    return Object.assign(resident, { retire });
  };
  const capture: MotionCapture = { samples: [] }, server = await walkingResident();
  try {
    for (const { leg } of physicsRoutes.filter(row => row.slug === SLUG)) {
      const report = captureJourney(server, v.parse(HeadlessJourneyPlanSchema, { ticks: Math.ceil(leg.timeout * 60), start: leg.start, once: true, holdActors: true,
        points: [{ x: leg.start.x, z: leg.start.z }, ...leg.waypoints], ...(leg.inside === undefined ? {} : { inside: leg.inside }) }), capture);
      expect(report.stuck, leg.name).toEqual([]);
    }
  } finally { server.retire(); server.dispose(); }
  const client = await walkingResident();
  try {
    const replay = replayOnClient(client, capture);
    console.info(JSON.stringify({ diagnostic: 'motion-replay', slug: SLUG, ...replay }));
    expect(replay.ticks).toBe(capture.samples.length);
    expect(replay.worst).toBeLessThan(LIMIT);
    expect(replay.overTolerance).toBe(0);
    expect(replay.groundTicks).toBe(0);
  } finally { client.retire(); client.dispose(); }
}, 120_000);
