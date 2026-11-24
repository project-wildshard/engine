// ONE-FORMAT OF22a3: a native assembly with no `collision` host stands its bake's ground and the shard's own prop solids.
// Driftwood's `collision` host stands 2,000-odd baked solids (cuboids, capsules, convex hulls, each with a material, groups
// and friction); its move turns them into `props.colliders` rows (shard-format 0.52.0). Driftwood rev 7 (OF22e2)
// ships that move, so the proof is the shipped product: no collision host, probe rays meet its planks, a player on the pier
// stands, and it saves and restores exactly.
// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createNativeHeadlessResident, type NativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { serverInputFiles } from '../src/shared/game/shardfile/serverSkinRigs';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { tagOf } from '../src/shared/engine/physics/surface';
import { serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { canonicalSimDigest } from '../src/test/engine/simState';
import { builtFolder } from '../src/test/game/builtFolder';
import { shippedPlan } from '../src/test/game/shippedPlan';


async function shipped() {
  const directory = builtFolder('driftwood-isle'), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Missing admitted driftwood-isle output');
  const assets = new Map(serverInputFiles(descriptor.index.files, shard)
    .map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return { product, shard, assets, rapier };
}
type Shipped = Awaited<ReturnType<typeof shipped>>;

const open = (fixture: Shipped, snapshot?: string): Promise<NativeHeadlessResident> =>
  createNativeHeadlessResident({ shard: fixture.shard, assets: fixture.assets, rapier: fixture.rapier, product: fixture.product }, snapshot);

/** A ray straight down at each grid point of the island: the height and material it meets. */
function probe(live: NativeHeadlessResident, rapier: Shipped['rapier']): string[] {
  const world = live.host.physics.world, out: string[] = [];
  for (let x = -230; x <= 230; x += 5) for (let z = -230; z <= 230; z += 5) {
    const hit = world.castRay(new rapier.Ray({ x, y: 240, z }, { x: 0, y: -1, z: 0 }), 500, true);
    const collider = hit === null ? null : hit.collider;
    out.push(hit === null || collider === null ? `${String(x)},${String(z)}:none` : `${String(x)},${String(z)}:${(240 - hit.timeOfImpact).toFixed(3)}:${tagOf(collider)?.material ?? '?'}`);
  }
  return out;
}

test('Driftwood with no collision host stands its ground and solids from its prop rows, and saves and restores', async () => {
  const fixture = await shipped();
  // Driftwood rev 7 (OF22e2) ships the move: its plan names no collision host and its solids are prop rows
  const plan = await shippedPlan(fixture.product); // FP16b: no plan file from the SDK 0.4.30 pin on, so no host named
  expect(plan.features.map(row => row.host)).not.toContain('collision');
  expect(fixture.shard.props?.colliders.length ?? 0).toBeGreaterThan(10);
  const live = await open(fixture);
  let restored: NativeHeadlessResident | undefined;
  try {
    live.step([]);
    expect(probe(live, fixture.rapier).filter(row => row.endsWith(':planks')).length).toBeGreaterThan(10);
    // A player set on the pier's planks stands there
    const player = leadPlayer(live.host); player.position.set(0, 3, -225); player.velocity.set(0, 0, 0);
    for (let tick = 0; tick < 60; tick++) live.step([]);
    expect(player.position.y).toBeGreaterThan(1);
    expect(player.fall.grounded).toBe(true);
    const saved = serializeSimSnapshot(snapshotSimHost(live.host));
    restored = await open(fixture, saved);
    expect(canonicalSimDigest(snapshotSimHostBytes(restored.host))).toBe(canonicalSimDigest(snapshotSimHostBytes(live.host)));
    for (let tick = 0; tick < 30; tick++) { live.step([]); restored.step([]); }
    expect(canonicalSimDigest(snapshotSimHostBytes(restored.host))).toBe(canonicalSimDigest(snapshotSimHostBytes(live.host)));
  } finally { live.dispose(); restored?.dispose(); }
}, 120_000);
