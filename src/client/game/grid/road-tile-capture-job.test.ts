import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry, InterleavedBuffer, InterleavedBufferAttribute, Mesh, MeshBasicMaterial, Sphere, Vector3 } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { finishRoadSteps, type CullPlan } from './roadCull';
import { compactRoadTileSteps } from './roadTileGeometry';
import { coarseRoadTileSteps } from './roadTileCoarse';
import { contentHash } from '../../../shared/game/shardfile/contentHash';
import { encodeRoadTile, type RoadTileStore } from './roadTileArchive';
import { RoadTileBacking } from './roadTileBacking';
import { captureJobTiles } from './roadTileCaptureJob';
import { captureJob, captureJobBytes } from './roadTileCaptureWorker';

// two attributes (one normalized integer), fine runs with an LOD level, two tiles a coarse parent
function fixture(count = 12): { mesh: Mesh; plan: CullPlan; close: () => void } {
  const geometry = new BufferGeometry(), positions = new Float32Array(count * 9), colours = new Uint8Array(count * 9), index = new Uint32Array(count * 6);
  const bins: CullPlan['bins'][number][] = [];
  for (let tile = 0; tile < count; tile++) {
    positions.set([tile, 0, 0, tile + 1, 0.5, 0, tile, 0, 1], tile * 9);
    colours.set([tile, 2 * tile, 255, 0, 9, tile, 7, 7, 7], tile * 9);
    for (let at = 0; at < 6; at++) index[tile * 6 + at] = tile * 3 + (at < 3 ? at : 5 - at);
    bins.push({ start: tile * 6, count: 3, levels: [{ start: tile * 6 + 3, count: 3 }], sphere: new Sphere(new Vector3(tile, 0.25, 0.5), 1.5), tile: { x: tile, z: tile % 3 } });
  }
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colours, 3, true));
  const material = new MeshBasicMaterial(), mesh = new Mesh(geometry, material);
  return { mesh, plan: { source: index, bins, lod: [150] }, close: () => { geometry.dispose(); material.dispose(); } };
}
function memoryStore(): { store: RoadTileStore; bodies: Map<string, Uint8Array> } {
  const bodies = new Map<string, Uint8Array>();
  return { bodies, store: { get: hash => Promise.resolve(bodies.get(hash)?.slice() ?? null), put: (hash, bytes) => { bodies.set(hash, bytes.slice()); return Promise.resolve(true); } } };
}
function parents(plan: CullPlan): { x: number; z: number }[] {
  const out = new Map<string, { x: number; z: number }>();
  for (const bin of plan.bins) if (bin.tile !== undefined) { const x = Math.floor(bin.tile.x / 2), z = Math.floor(bin.tile.z / 2); out.set([x, z].join(','), { x, z }); }
  return [...out.values()];
}
/** The references' contract: the authored order, each fine bin in order and then each coarse parent (an empty one
 *  skipped), as both paths commit them. Computed serially here; the page path's puts themselves run concurrently, so
 *  their completion order is not that order and is never compared. */
async function authoredHashes(mesh: Mesh, plan: CullPlan): Promise<string[]> {
  const out: string[] = [];
  for (const bin of plan.bins) {
    if (bin.tile === undefined) throw new Error('Missing fixture tile');
    const data = finishRoadSteps(compactRoadTileSteps(mesh.geometry, plan, bin.tile.x, bin.tile.z));
    try { out.push(await contentHash(encodeRoadTile(data))); } finally { data.geometry.dispose(); }
  }
  for (const { x, z } of parents(plan)) {
    const data = finishRoadSteps(coarseRoadTileSteps(mesh.geometry, plan, x, z));
    try { if (data.plan.source.length > 0) out.push(await contentHash(encodeRoadTile(data))); } finally { data.geometry.dispose(); }
  }
  return out;
}
// the page path's archive (its bodies; its puts complete in any order)
async function pagePath(mesh: Mesh, plan: CullPlan, store: RoadTileStore): Promise<number> {
  const scope = new Scope('page capture'), backing = new RoadTileBacking(scope, store, { pitch: 125, plans: new Map() });
  const steps = backing.capture(mesh, plan);
  for (;;) { const next = steps.next(), pending = backing.flush(); if (pending !== null) await pending; if (next.done === true) break; }
  const backed = backing.state().backedTiles;
  scope.dispose(); return backed;
}

test('a captured job (through structured clone) writes the page path\'s exact bodies and references, in order', async () => {
  const f = fixture(), page = memoryStore(), worker = memoryStore();
  const backed = await pagePath(f.mesh, f.plan, page.store), authored = await authoredHashes(f.mesh, f.plan);
  const job = captureJob(0, 'https://wildshard.test', f.mesh.geometry, f.plan, parents(f.plan));
  if (job === null) throw new Error('Missing capture job');
  const result = await captureJobTiles(structuredClone(job), worker.store);
  expect([...result.fine, ...result.coarse].map(reference => reference.hash)).toEqual(authored);
  expect(backed).toBe(authored.length);
  expect(result.fine).toHaveLength(12); expect(result.coarse.length).toBeGreaterThan(0);
  for (const reference of [...result.fine, ...result.coarse]) expect(reference.wireBytes).toBe(page.bodies.get(reference.hash)?.length);
  expect([...worker.bodies.keys()].sort()).toEqual([...page.bodies.keys()].sort());
  for (const [hash, bytes] of page.bodies) expect(worker.bodies.get(hash)).toEqual(bytes);
  // the page keeps its own arrays: the job copied them
  expect(f.mesh.geometry.getAttribute('position').count).toBe(36);
  f.close();
});

test('a stored body is not rewritten, and an interleaved source keeps the page path', async () => {
  const f = fixture(4), store = memoryStore();
  const job = captureJob(1, 'https://wildshard.test', f.mesh.geometry, f.plan, parents(f.plan));
  if (job === null) throw new Error('Missing capture job');
  await captureJobTiles(job, store.store);
  let writes = 0; const counted: RoadTileStore = { get: store.store.get, put: (hash, bytes) => { writes++; return store.store.put(hash, bytes); } };
  await captureJobTiles(job, counted); expect(writes).toBe(0);
  const interleaved = new BufferGeometry();
  interleaved.setAttribute('position', new InterleavedBufferAttribute(new InterleavedBuffer(new Float32Array(9), 3), 3, 0));
  expect(captureJob(2, 'https://wildshard.test', interleaved, f.plan, [])).toBeNull();
  interleaved.dispose(); f.close();
});

test('a view over a large buffer is copied tight: the job charges and clones only its bytes', async () => {
  const big = new ArrayBuffer(64 * 1024 * 1024), positions = new Float32Array(big, 4096, 9), index = new Uint32Array(new ArrayBuffer(1 << 20), 64, 3);
  positions.set([0, 0, 0, 1, 0, 0, 0, 0, 1]); index.set([0, 1, 2]);
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const plan: CullPlan = { source: index, lod: [], bins: [{ start: 0, count: 3, levels: [], sphere: new Sphere(new Vector3(), 1), tile: { x: 0, z: 0 } }] };
  const job = captureJob(3, 'https://wildshard.test', geometry, plan, [{ x: 0, z: 0 }]);
  if (job === null) throw new Error('Missing capture job');
  for (const row of job.attributes) expect(row.array.buffer.byteLength).toBe(row.array.byteLength);
  expect(job.source.buffer.byteLength).toBe(12);
  expect(captureJobBytes(job)).toBe(36 + 12);
  // the tight copies carry the same values, and the page's own view is untouched
  expect(Array.from(job.attributes[0]?.array ?? [])).toEqual(Array.from(positions)); expect(Array.from(job.source)).toEqual([0, 1, 2]);
  expect(positions.buffer).toBe(big);
  const store = memoryStore(), result = await captureJobTiles(structuredClone(job), store.store);
  expect(result.fine).toHaveLength(1);
  geometry.dispose();
});
