// meta IPHONE13-DRIFTWOOD DW12 (mini-dw12c): the road tile capture job holds a fixed handful of arrays, not a few a tile.
// In headless WebKit a ~35 MB source's worker capture (~500 tiles) put WebContent up 157 to 173 MB, all of it per-tile
// garbage (a Map, number arrays, output arrays, the encoded body and the cache put's copy). A lean job writes every tile
// through one vertex table and six reused arenas; the archived bodies and references stay byte for byte the same.
import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three';
import type { CullPlan } from './roadCull';
import { roadTileCache, type RoadTileStore } from './roadTileArchive';
import { captureJobTiles } from './roadTileCaptureJob';
import { captureJob, roadCaptureLean, type CaptureJob } from './roadTileCaptureWorker';
import { RoadTileArena, roadVertexTablesMade } from './roadTileGeometry';

/** `tiles` tiles on a 6-wide lattice; each tile's fine run and two LOD runs reuse its vertices (and a neighbour's, so a
 *  vertex is seen by several tiles), in a scrambled order; positions float, colours normalized bytes, sizes differ. */
function source(tiles: number): { geometry: BufferGeometry; plan: CullPlan; parents: { x: number; z: number }[] } {
  const per = 24, vertices = tiles * per, geometry = new BufferGeometry();
  const positions = new Float32Array(vertices * 3), colours = new Uint8Array(vertices * 4), shade = new Float32Array(vertices);
  for (let v = 0; v < vertices; v++) {
    positions.set([v * 0.5, Math.sin(v) * 3, (v % 7) * 1.25], v * 3);
    colours.set([v % 251, (v * 7) % 256, (v * 13) % 256, 255], v * 4); shade[v] = (v % 17) / 16;
  }
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colours, 4, true));
  geometry.setAttribute('shade', new BufferAttribute(shade, 1));
  const index: number[] = [], bins: CullPlan['bins'][number][] = [], parents = new Map<string, { x: number; z: number }>();
  for (let tile = 0; tile < tiles; tile++) {
    const base = tile * per, next = ((tile + 1) % tiles) * per, runs: { start: number; count: number }[] = [];
    for (const [triangles, stride] of [[10 + (tile % 5), 5], [6, 7], [3, 11]] as const) {
      const start = index.length;
      for (let t = 0; t < triangles; t++) for (let k = 0; k < 3; k++) {
        const pick = (t * stride + k * 3 + tile) % (per + 4);
        index.push(pick < per ? base + pick : next + pick - per);
      }
      runs.push({ start, count: index.length - start });
    }
    const [fine, ...levels] = runs; if (fine === undefined) throw new Error('fixture');
    const x = tile % 6, z = Math.floor(tile / 6);
    bins.push({ ...fine, levels, sphere: new Sphere(new Vector3(x * 62.5, 0, z * 62.5), 40 + tile), tile: { x, z } });
    parents.set(`${String(Math.floor(x / 2))},${String(Math.floor(z / 2))}`, { x: Math.floor(x / 2), z: Math.floor(z / 2) });
  }
  return { geometry, plan: { source: Uint32Array.from(index), bins, lod: [150, 450] }, parents: [...parents.values()] };
}
/** A store that keeps a copy of each body and the buffer each body arrived in. */
function keeping(): { store: RoadTileStore; bodies: Map<string, Uint8Array>; buffers: Set<ArrayBufferLike> } {
  const bodies = new Map<string, Uint8Array>(), buffers = new Set<ArrayBufferLike>();
  return { bodies, buffers, store: { get: () => Promise.resolve(null), put: (hash, bytes) => {
    buffers.add(bytes.buffer); bodies.set(hash, bytes.slice()); return Promise.resolve(true);
  } } };
}
function job(tiles: number, lean: boolean): CaptureJob {
  const fixture = source(tiles), made = captureJob(7, 'https://wildshard.test', fixture.geometry, fixture.plan, fixture.parents, lean);
  if (made === null) throw new Error('Missing capture job');
  return made;
}

test('a lean job archives the same bodies and references as the plain job', async () => {
  const plain = keeping(), lean = keeping();
  const before = await captureJobTiles(job(40, false), plain.store), after = await captureJobTiles(job(40, true), lean.store);
  expect(after).toEqual(before);
  expect(before.fine).toHaveLength(40); expect(before.coarse.length).toBeGreaterThan(5);
  expect([...lean.bodies.keys()]).toEqual([...plain.bodies.keys()]);
  for (const [hash, body] of plain.bodies) expect(lean.bodies.get(hash)).toEqual(body);
});

test('a lean job holds a fixed handful of buffers however many tiles it writes', async () => {
  const counts: number[] = [];
  for (const tiles of [12, 48]) {
    const plain = keeping(), lean = keeping(), tables = roadVertexTablesMade();
    const result = await captureJobTiles(job(tiles, true), lean.store);
    await captureJobTiles(job(tiles, false), plain.store);
    // the plain job hands every body over in a buffer of its own; the lean one reuses one arena's (grown by doubling)
    expect(plain.buffers.size).toBe(result.fine.length + result.coarse.length);
    expect(lean.buffers.size).toBeLessThanOrEqual(4);
    expect(roadVertexTablesMade() - tables).toBe(1);
    counts.push(lean.buffers.size);
  }
  expect(counts[1]).toBeLessThanOrEqual((counts[0] ?? 0) + 1);
  // an arena reuses its array for a smaller or equal take, and grows by doubling
  const arena = new RoadTileArena(), first = arena.take('index', new Uint32Array(0), 30);
  expect(arena.take('index', new Uint32Array(0), 12).buffer).toBe(first.buffer);
  expect(arena.take('index', new Uint32Array(0), 40).length).toBe(40); expect(arena.allocations).toBe(2);
});

test('the lean cache put stores each body before the arena is reused, and a store that takes the buffer is survived', async () => {
  const plain = keeping();
  const reference = await captureJobTiles(job(30, false), plain.store);
  // a Cache Storage stand-in that reads the Response only once put runs, as the browser's does
  const cached = new Map<string, Uint8Array>();
  const storage = { open: () => Promise.resolve({ put: async (url: string, response: Response) => {
    await Promise.resolve(); cached.set(url, new Uint8Array(await response.arrayBuffer()));
  } }) } as unknown as Pick<CacheStorage, 'open'>;
  const lean = await captureJobTiles(job(30, true), roadTileCache(storage, 'https://wildshard.test', true));
  expect(lean).toEqual(reference);
  for (const [hash, body] of plain.bodies) expect(cached.get(`https://wildshard.test/assets/grid-road/${hash}.bin`)).toEqual(body);
  // roadTileWriter transfers a whole-buffer body to its write worker: the arena's buffer detaches and is replaced
  const taken = new Map<string, Uint8Array>();
  const transferring: RoadTileStore = { get: () => Promise.resolve(null), put: (hash, bytes) => {
    const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
    taken.set(hash, whole ? new Uint8Array(structuredClone(bytes.buffer, { transfer: [bytes.buffer as ArrayBuffer] })) : bytes.slice());
    return Promise.resolve(true);
  } };
  expect(await captureJobTiles(job(30, true), transferring)).toEqual(reference);
  for (const [hash, body] of plain.bodies) expect(taken.get(hash)).toEqual(body);
});

test('the slot is off unless set', () => {
  expect(roadCaptureLean(null)).toBe(false); expect(roadCaptureLean(undefined)).toBe(false);
  expect(roadCaptureLean(true)).toBe(true); expect(roadCaptureLean('on')).toBe(true);
  expect(roadCaptureLean(false)).toBe(false); expect(roadCaptureLean('off')).toBe(false);
});
