// ONE-FORMAT OF22a3: a native assembly with no `collision` host stands its bake's ground and the shard's own prop solids.
// Driftwood's `collision` host stands 2,000-odd baked solids (cuboids, capsules, convex hulls, each with a material, groups
// and friction); its move turns them into `props.colliders` rows (shard-format 0.52.0). The proof is the shipped Driftwood
// product beside the same product with `collision` cut from its plan and the bake's solids written as prop rows, converted
// here as the shard converts them: every probe ray down the island meets the same surface at the same height, a player
// walking off the pier stands as on the island, and the cut product saves and restores exactly.
// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parse } from 'valibot';
import { NATIVE_ASSEMBLY_FILE, parseNativeAssembly } from '@wildshard/format/nativeAssembly';
import { PropsSchema } from '@wildshard/format/props';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createNativeHeadlessResident, type NativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { readAssemblyInput } from '../src/server/game/shardfile/nativeAssemblyInput';
import { outputDescriptor, serverReadsFile } from '../src/shared/game/shardfile/outputDescriptor';
import type { ShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { tagOf } from '../src/shared/engine/physics/surface';
import { serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { canonicalSimDigest } from '../src/test/engine/simState';
import { builtFolder } from '../src/test/game/builtFolder';

interface BakedSolid { shape: number; groups: number; friction: number; material: string; owner?: string; at: number[]; rot: number[]; half?: number[]; halfHeight?: number; radius?: number; vertices?: { file: string; byteOffset: number; byteLength: number } }

async function shipped() {
  const directory = builtFolder('driftwood-isle'), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Missing admitted driftwood-isle output');
  const assets = new Map(descriptor.index.files.filter(file => serverReadsFile(file, shard.terrain?.collider))
    .map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return { product, shard, assets, rapier };
}
type Shipped = Awaited<ReturnType<typeof shipped>>;

/** The bake's solids as prop rows, one row an owner, as shard-driftwood's `solidRows.ts` writes them (edge walls, the landings
 *  already declared and the engine's training room 900 m up stay out). */
async function solidRows(fixture: Shipped): Promise<NonNullable<Shardfile['props']>['colliders']> {
  const plan = parseNativeAssembly(JSON.parse(new TextDecoder().decode(await fixture.product.file(NATIVE_ASSEMBLY_FILE))));
  const bake = plan.bake; if (bake === undefined) throw new Error('Driftwood has its bake');
  const rows = await readAssemblyInput<{ solids: BakedSolid[] }>(fixture.product, bake.rows);
  const bins = new Map(await Promise.all(bake.colliders.map(async name => [name, await fixture.product.file(name)] as const)));
  const owners = new Map<string, NonNullable<Shardfile['props']>['colliders'][number]['shapes']>();
  for (const solid of rows.solids) {
    if (solid.material === 'edge' || solid.owner === undefined || solid.owner === 'piece:entry-landings' || solid.owner === 'piece:practice-arena') continue;
    const [x = 0, y = 0, z = 0] = solid.at, [qx = 0, qy = 0, qz = 0, qw = 1] = solid.rot;
    const pose = { x, y, z, rot: { x: qx, y: qy, z: qz, w: qw } }, contact = { surface: solid.material as 'wood', friction: solid.friction, groups: solid.groups };
    const shape = solid.shape === 1 && solid.half !== undefined ? { kind: 'box' as const, ...pose, hx: solid.half[0] ?? 0, hy: solid.half[1] ?? 0, hz: solid.half[2] ?? 0, ...contact }
      : solid.shape === 2 && solid.halfHeight !== undefined && solid.radius !== undefined ? { kind: 'capsule' as const, ...pose, halfHeight: solid.halfHeight, radius: solid.radius, ...contact }
      : solid.vertices !== undefined ? (() => { const bytes = bins.get(solid.vertices.file); if (bytes === undefined) throw new Error('Missing collider bin');
        const start = bytes.byteOffset + solid.vertices.byteOffset;
        return { kind: 'hull' as const, ...pose, points: Array.from(new Float32Array(bytes.buffer.slice(start, start + solid.vertices.byteLength))), ...contact }; })() : null;
    if (shape === null) throw new Error(`Unbuildable solid ${String(solid.shape)}`);
    const id = solid.owner.replace(/^string:/u, '').replace(/[:_]/gu, '.');
    owners.set(id, [...owners.get(id) ?? [], shape]);
  }
  return [...owners].flatMap(([id, shapes]) => Array.from({ length: Math.ceil(shapes.length / 256) }, (_unused, index) =>
    ({ id: index === 0 ? id : `${id}.${String(index + 1)}`, panel: null, initialActive: true, shapes: shapes.slice(index * 256, (index + 1) * 256) })));
}
/** The product with `collision` cut from its native plan and the bake's solids declared as prop rows. */
async function ownSolids(fixture: Shipped): Promise<{ product: ShardFolder; shard: Shardfile }> {
  const plan = JSON.parse(new TextDecoder().decode(await fixture.product.file(NATIVE_ASSEMBLY_FILE))) as { features: { host: string }[] };
  const bytes = new TextEncoder().encode(JSON.stringify({ ...plan, features: plan.features.filter(row => row.host !== 'collision') }));
  const props = fixture.shard.props; if (props === null) throw new Error('Driftwood declares its landings');
  // the rows admit as an upload's props section does (shard-format 0.52.0: capsules, contact materials, friction, groups)
  const shard: Shardfile = { ...fixture.shard, props: parse(PropsSchema, { ...props, colliders: [...props.colliders, ...await solidRows(fixture)] }) };
  return { shard, product: { ...fixture.product, shardfile: shard, file: name => name === NATIVE_ASSEMBLY_FILE ? Promise.resolve(bytes) : fixture.product.file(name) } };
}
const open = (fixture: Shipped, product: ShardFolder, shard: Shardfile, snapshot?: string): Promise<NativeHeadlessResident> =>
  createNativeHeadlessResident({ shard, assets: fixture.assets, rapier: fixture.rapier, product }, snapshot);

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

test('Driftwood with no collision host stands the same ground and solids from its prop rows, and saves and restores', async () => {
  const fixture = await shipped(), cut = await ownSolids(fixture);
  const whole = await open(fixture, fixture.product, fixture.shard), bare = await open(fixture, cut.product, cut.shard);
  let restored: NativeHeadlessResident | undefined;
  try {
    for (const live of [whole, bare]) live.step([]);
    const before = probe(whole, fixture.rapier), after = probe(bare, fixture.rapier);
    expect(after.filter((row, index) => row !== before[index])).toEqual([]);
    expect(before.filter(row => row.endsWith(':planks')).length).toBeGreaterThan(10);
    // A player set on the pier's planks stands there on both islands
    const heights = [whole, bare].map(live => {
      const player = leadPlayer(live.host); player.position.set(0, 3, -225); player.velocity.set(0, 0, 0);
      for (let tick = 0; tick < 60; tick++) live.step([]);
      return player.position.y;
    });
    expect(heights[1]).toBeCloseTo(heights[0] ?? Number.NaN, 3);
    const saved = serializeSimSnapshot(snapshotSimHost(bare.host));
    restored = await open(fixture, cut.product, cut.shard, saved);
    expect(canonicalSimDigest(snapshotSimHostBytes(restored.host))).toBe(canonicalSimDigest(snapshotSimHostBytes(bare.host)));
    for (let tick = 0; tick < 30; tick++) { bare.step([]); restored.step([]); }
    expect(canonicalSimDigest(snapshotSimHostBytes(restored.host))).toBe(canonicalSimDigest(snapshotSimHostBytes(bare.host)));
  } finally { whole.dispose(); bare.dispose(); restored?.dispose(); }
}, 120_000);
