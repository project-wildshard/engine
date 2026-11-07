import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry, Sphere } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { decodeRoadTile, encodeRoadTile, loadRoadTile, persistRoadTile, type RoadTileStore } from './roadTileArchive';
import type { RoadTileGeometry } from './roadTileGeometry';

function fixture(): RoadTileGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1]), 3));
  geometry.setAttribute('color', new BufferAttribute(Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255]), 3, true));
  const index = Uint32Array.from([0, 1, 2, 2, 1, 0]); geometry.setIndex(new BufferAttribute(index, 1));
  return { geometry, plan: { source: index, lod: [150], bins: [{ sphere: new Sphere(undefined, 1), start: 0, count: 3,
    levels: [{ start: 3, count: 3 }], tile: { x: -1, z: 2 } }] }, bytes: { jsBytes: 93, gpuBytes: 69 } };
}

test('road backing round-trips scalar bytes, normalized colour and every LOD independently', () => {
  const original = fixture(), packed = encodeRoadTile(original), tile = decodeRoadTile(packed);
  expect(tile.bytes).toEqual(original.bytes);
  expect(tile.plan.bins[0]?.tile).toEqual({ x: -1, z: 2 });
  expect(tile.plan.bins[0]?.levels).toEqual([{ start: 3, count: 3 }]);
  expect(Array.from(tile.plan.source)).toEqual([0, 1, 2, 2, 1, 0]);
  const colour = tile.geometry.getAttribute('color');
  expect(colour.normalized).toBe(true); expect(colour.array).toBeInstanceOf(Uint8Array);
  packed.fill(0); original.geometry.getAttribute('position').setX(0, 500);
  expect(tile.geometry.getAttribute('position').getX(0)).toBe(0); expect(colour.array[0]).toBe(255);
  original.geometry.dispose(); tile.geometry.dispose();
});

test('invalid archive bounds and byte plans refuse before geometry publication', () => {
  const original = fixture(), packed = encodeRoadTile(original);
  const length = packed.slice(); new DataView(length.buffer).setUint32(0, 100_000, true);
  expect(() => decodeRoadTile(length)).toThrow('header length');
  expect(() => decodeRoadTile(packed.subarray(0, -1))).toThrow('size mismatch');
  expect(() => encodeRoadTile({ ...original, bytes: { jsBytes: 0, gpuBytes: 0 } })).toThrow('byte plan mismatch');
  original.geometry.dispose();
});

test('durable refs pin to their owner and reload rejects poisoned storage', async () => {
  const scope = new Scope('road archive'), child = scope.child('loaded'), original = fixture(), bodies = new Map<string, Uint8Array>();
  let pins = 0, released = 0;
  const store: RoadTileStore = {
    put: (hash, bytes) => { bodies.set(hash, Uint8Array.from(bytes)); return Promise.resolve(true); },
    get: hash => Promise.resolve(bodies.get(hash) ?? null),
    pin: () => { pins++; let active = true; return () => { if (active) { active = false; released++; } }; },
  };
  const ref = await persistRoadTile(scope, store, original);
  expect(pins).toBe(1); expect(released).toBe(0);
  const tile = await loadRoadTile(child, store, ref); expect(tile.bytes).toEqual(original.bytes);
  const poisoned = bodies.get(ref.hash); if (poisoned === undefined) throw new Error('Missing stored road tile');
  poisoned.fill(0);
  await expect(loadRoadTile(child, store, ref)).rejects.toThrow('archive unavailable');
  scope.dispose(); expect(released).toBe(1); original.geometry.dispose();
});

test('quota refusal releases the provisional pin and preserves original geometry', async () => {
  const scope = new Scope('road refusal'), original = fixture(); let releases = 0;
  const store: RoadTileStore = { get: () => Promise.resolve(null), put: () => Promise.resolve(false), pin: () => () => { releases++; } };
  await expect(persistRoadTile(scope, store, original)).rejects.toThrow('storage refused');
  expect(releases).toBe(1); expect(original.geometry.getAttribute('position').count).toBe(3);
  scope.dispose(); expect(releases).toBe(1); original.geometry.dispose();
});

test('reload refuses changed scalar bytes even when every archive shape remains valid', async () => {
  const scope = new Scope('road digest'), original = fixture();
  let stored: Uint8Array | undefined;
  const store: RoadTileStore = {
    get: () => Promise.resolve(stored?.slice() ?? null),
    put: (_hash, bytes) => { stored = bytes.slice(); return Promise.resolve(true); },
  };
  const ref = await persistRoadTile(scope, store, original);
  if (stored === undefined) throw new Error('Missing stored road tile');
  const headerBytes = new DataView(stored.buffer, stored.byteOffset, stored.byteLength).getUint32(0, true);
  new DataView(stored.buffer, stored.byteOffset, stored.byteLength).setFloat32(4 + headerBytes, 0.5, true);
  const valid = decodeRoadTile(stored);
  expect(valid.geometry.getAttribute('position').getX(0)).toBe(0.5);
  valid.geometry.dispose();
  await expect(loadRoadTile(scope, store, ref)).rejects.toThrow('archive unavailable');
  scope.dispose(); original.geometry.dispose();
});

test('warm archives reuse only the complete freshly encoded content and retain each owner pin', async () => {
  const cold = new Scope('cold road'), warm = new Scope('warm road'), original = fixture();
  const bodies = new Map<string, Uint8Array>(); let writes = 0, released = 0;
  const store: RoadTileStore = {
    get: hash => Promise.resolve(bodies.get(hash)?.slice() ?? null),
    put: (hash, bytes) => { writes++; bodies.set(hash, bytes.slice()); return Promise.resolve(true); },
    pin: () => () => { released++; },
  };
  const before = encodeRoadTile(original), first = await persistRoadTile(cold, store, original);
  expect(await persistRoadTile(warm, store, original)).toEqual(first);
  expect(bodies.get(first.hash)).toEqual(before); expect(writes).toBe(1); expect(released).toBe(0);
  cold.dispose(); expect(released).toBe(1); warm.dispose(); expect(released).toBe(2);
  original.geometry.dispose();
});

test('same-length poisoned, truncated and unreadable archives keep the original write and quota refusal', async () => {
  const original = fixture(), bytes = encodeRoadTile(original), poisoned = bytes.slice();
  poisoned.set([1], poisoned.length - 1);
  for (const read of [() => Promise.resolve(poisoned), () => Promise.resolve(bytes.subarray(0, -1)),
    () => Promise.reject(new Error('Unavailable cache'))]) {
    for (const accepted of [true, false]) {
      const scope = new Scope('road repair'); let writes = 0, releases = 0;
      const store: RoadTileStore = { get: read,
        put: (_hash, body) => { writes++; expect(body).toEqual(bytes); return Promise.resolve(accepted); },
        pin: () => () => { releases++; },
      };
      const result = persistRoadTile(scope, store, original);
      await (accepted ? expect(result).resolves.toMatchObject({ wireBytes: bytes.length })
        : expect(result).rejects.toThrow('storage refused'));
      expect(writes).toBe(1); scope.dispose(); expect(releases).toBe(1);
    }
  }
  original.geometry.dispose();
});

test('retirement during a warm read prevents writing and releases its pin exactly once', async () => {
  const scope = new Scope('retired warm road'), original = fixture(); let writes = 0, releases = 0;
  const store: RoadTileStore = {
    get: () => { scope.dispose(); return Promise.resolve(null); },
    put: () => { writes++; return Promise.resolve(true); }, pin: () => () => { releases++; },
  };
  await expect(persistRoadTile(scope, store, original)).rejects.toThrow('owner retired');
  expect(writes).toBe(0); expect(releases).toBe(1);
  expect(original.geometry.getAttribute('position').count).toBe(3); original.geometry.dispose();
});

test('invalid current geometry cannot borrow a valid archive', async () => {
  const scope = new Scope('invalid current road'), original = fixture(); let reads = 0, writes = 0;
  const store: RoadTileStore = { get: () => { reads++; return Promise.resolve(encodeRoadTile(original)); },
    put: () => { writes++; return Promise.resolve(true); } };
  await expect(persistRoadTile(scope, store, { ...original, bytes: { jsBytes: 0, gpuBytes: 0 } })).rejects.toThrow('byte plan mismatch');
  expect(reads).toBe(0); expect(writes).toBe(0); scope.dispose(); original.geometry.dispose();
});
