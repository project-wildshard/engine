import { expect, test, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, Sphere } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { noteFrameDrawn } from '@wildshard/engine/core/framePacing';
import { contentHash } from '../../../shared/game/shardfile/contentHash';
import { finishRoadSteps, type CullPlan } from './roadCull';
import { decodeRoadTile, encodeRoadTile, type RoadTileStore } from './roadTileArchive';
import { RoadTileBacking, retireWholeRoadMesh } from './roadTileBacking';
import { compactRoadTileSteps } from './roadTileGeometry';
import { coarseRoadTileSteps } from './roadTileCoarse';

function fixture(count = 8, run = 3): { mesh: Mesh; plan: CullPlan; close: () => void } {
  const geometry = new BufferGeometry(), positions = new Float32Array(count * 9), index = new Uint32Array(count * run * 2);
  const bins: CullPlan['bins'][number][] = [];
  for (let tile = 0; tile < count; tile++) {
    positions.set([tile, 0, 0, tile + 1, 0, 0, tile, 0, 1], tile * 9);
    const start = tile * run * 2;
    for (let at = 0; at < run * 2; at++) index[start + at] = tile * 3 + at % 3;
    bins.push({ start, count: run, levels: [{ start: start + run, count: run }], sphere: new Sphere(undefined, 1), tile: { x: tile * 2, z: 0 } });
  }
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const material = new MeshBasicMaterial(), mesh = new Mesh(geometry, material);
  return { mesh, plan: { source: index, bins, lod: [150] }, close: () => { geometry.dispose(); material.dispose(); } };
}
async function serialBodies(mesh: Mesh, plan: CullPlan): Promise<Map<string, Uint8Array>> {
  const bodies = new Map<string, Uint8Array>(), parents = new Map<string, { x: number; z: number }>();
  for (const bin of plan.bins) {
    const at = bin.tile; if (at === undefined) throw new Error('Missing fixture tile');
    const data = finishRoadSteps(compactRoadTileSteps(mesh.geometry, plan, at.x, at.z));
    try { const bytes = encodeRoadTile(data); bodies.set(await contentHash(bytes), bytes); }
    finally { data.geometry.dispose(); }
    const x = Math.floor(at.x / 2), z = Math.floor(at.z / 2); parents.set([x, z].join(','), { x, z });
  }
  for (const at of parents.values()) {
    const data = finishRoadSteps(coarseRoadTileSteps(mesh.geometry, plan, at.x, at.z));
    try { const bytes = encodeRoadTile(data); bodies.set(await contentHash(bytes), bytes); }
    finally { data.geometry.dispose(); }
  }
  return bodies;
}
async function capture(backing: RoadTileBacking, mesh: Mesh, plan: CullPlan): Promise<void> {
  const steps = backing.capture(mesh, plan); let complete = false;
  try {
    for (;;) {
      const next = steps.next(), pending = backing.flush();
      if (pending !== null) await pending;
      if (next.done) { complete = true; return; }
    }
  } finally {
    try { if (!complete) steps.return(); }
    finally { await backing.settlePending(); }
  }
}
function gatedStore(first: number, quota = true): {
  store: RoadTileStore; bodies: Map<string, Uint8Array>; started: Promise<void>; release: () => void;
  counts: { reads: number; active: number; peak: number; writes: number; pins: number; releases: number };
} {
  const bodies = new Map<string, Uint8Array>(), gates: (() => void)[] = [];
  let start = (): void => undefined;
  const started = new Promise<void>(resolve => { start = resolve; });
  const counts = { reads: 0, active: 0, peak: 0, writes: 0, pins: 0, releases: 0 };
  const store: RoadTileStore = {
    get: async hash => {
      counts.reads++; counts.active++; counts.peak = Math.max(counts.peak, counts.active);
      try {
        if (counts.reads <= first) await new Promise<void>(resolve => { gates.push(resolve); if (gates.length === first) start(); });
        return bodies.get(hash)?.slice() ?? null;
      } finally { counts.active--; }
    },
    put: (hash, bytes) => { counts.writes++; if (quota) bodies.set(hash, bytes.slice()); return Promise.resolve(quota); },
    pin: () => { counts.pins++; return () => { counts.releases++; }; },
  };
  return { store, bodies, counts, started, release: () => { for (const resolve of [...gates].reverse()) resolve(); } };
}

test('bounded independent archives drain before capture returns and retain every serial byte', async () => {
  const f = fixture(40), scope = new Scope('road pipeline'), store = gatedStore(32), expected = await serialBodies(f.mesh, f.plan);
  const backing = new RoadTileBacking(scope, store.store, { pitch: 125, plans: new Map() });
  const work = capture(backing, f.mesh, f.plan);
  await store.started;
  expect(store.counts.reads).toBe(32); expect(backing.state().backedTiles).toBe(0);
  await expect(backing.settlePending()).rejects.toThrow('capture must close');
  store.release(); await work;
  expect(store.counts.peak).toBe(32); expect(store.counts.active).toBe(0);
  expect(store.counts.reads).toBe(80); expect(backing.state().backedTiles).toBe(80);
  expect([...store.bodies.keys()].sort()).toEqual([...expected.keys()].sort());
  for (const [hash, bytes] of expected) expect(store.bodies.get(hash)).toEqual(bytes);
  const warm = fixture(40), writes = store.counts.writes;
  await capture(backing, warm.mesh, warm.plan);
  expect(store.counts.writes).toBe(writes); expect(backing.state().backedTiles).toBe(160);
  scope.dispose(); expect(store.counts.releases).toBe(store.counts.pins); warm.close(); f.close();
});

test.each(['large', 'unknown'] as const)('%s scratch estimates retain the original serial path', async mode => {
  const f = fixture(2, mode === 'large' ? 60_000 : 3), scope = new Scope('large road scratch'), store = gatedStore(1);
  if (mode === 'unknown') {
    const attribute = f.mesh.geometry.getAttribute('position'), array = attribute.array;
    Object.defineProperty(attribute, 'array', { get: () => array });
  }
  const backing = new RoadTileBacking(scope, store.store, { pitch: 125, plans: new Map() });
  const work = capture(backing, f.mesh, f.plan); await store.started;
  expect(store.counts.reads).toBe(1); store.release(); await work;
  expect(store.counts.peak).toBe(1); expect(store.counts.reads).toBe(4);
  scope.dispose(); expect(store.counts.releases).toBe(store.counts.pins); f.close();
});

test.each([0, 31])('a completed slot %i refills while 31 reads remain held; references stay authored', async completed => {
  const f = fixture(40), scope = new Scope('rolling road archives');
  const expected = await serialBodies(f.mesh, f.plan), bodies = new Map<string, Uint8Array>();
  const release: (() => void)[] = []; let reads = 0, active = 0, peak = 0;
  let windowReady = (): void => undefined, nextAdmitted = (): void => undefined;
  const firstWindow = new Promise<void>(resolve => { windowReady = resolve; });
  const refilled = new Promise<void>(resolve => { nextAdmitted = resolve; });
  const backing = new RoadTileBacking(scope, {
    get: async hash => {
      reads++; active++; peak = Math.max(peak, active);
      try {
        if (reads <= 32) await new Promise<void>(resolve => { release.push(resolve); if (release.length === 32) windowReady(); });
        else if (reads === 33) nextAdmitted();
        return bodies.get(hash)?.slice() ?? null;
      } finally { active--; }
    },
    put: (hash, bytes) => { bodies.set(hash, bytes.slice()); return Promise.resolve(true); },
  }, { pitch: 125, plans: new Map() });
  const work = capture(backing, f.mesh, f.plan);
  try {
    await firstWindow; release[completed]?.(); await refilled;
    expect(reads).toBe(33); expect(active).toBe(31); expect(peak).toBe(32);
    if (completed === 31) expect(backing.state().backedTiles).toBe(0);
  } finally { for (const done of release) done(); await work; scope.dispose(); f.close(); }
  expect(reads).toBe(80); expect(active).toBe(0);
  expect([...bodies.keys()].sort()).toEqual([...expected.keys()].sort());
  for (const [hash, bytes] of expected) expect(bodies.get(hash)).toEqual(bytes);
});

test('quota failure drains every started operation and publishes no failed source', async () => {
  const f = fixture(40), scope = new Scope('road pipeline quota'), store = gatedStore(32, false);
  const backing = new RoadTileBacking(scope, store.store, { pitch: 125, plans: new Map() });
  const work = capture(backing, f.mesh, f.plan), refused = expect(work).rejects.toThrow('storage refused');
  await store.started; store.release(); await refused;
  expect(store.counts.reads).toBe(32); expect(store.counts.active).toBe(0);
  expect(backing.state().materials).toBe(0); expect(backing.state().backedTiles).toBe(0);
  expect(store.counts.releases).toBe(store.counts.pins); scope.dispose(); f.close();
});

test('retirement joins late reads, refuses late writes and releases each pin once', async () => {
  const f = fixture(40), scope = new Scope('road pipeline retirement'), store = gatedStore(32);
  const backing = new RoadTileBacking(scope, store.store, { pitch: 125, plans: new Map() });
  const work = capture(backing, f.mesh, f.plan), refused = expect(work).rejects.toThrow('owner retired');
  await store.started; scope.dispose();
  let settled = false; const joining = (async () => { await backing.settlePending(); settled = true; })();
  await Promise.resolve(); expect(settled).toBe(false);
  store.release(); await refused; await joining;
  expect(store.counts.active).toBe(0); expect(store.counts.reads).toBe(32); expect(store.counts.writes).toBe(0);
  expect(store.counts.releases).toBe(store.counts.pins); expect(backing.state().materials).toBe(0); f.close();
});

test('out-of-order failures retain the first authored refusal after all started work drains', async () => {
  const f = fixture(40), scope = new Scope('road authored refusal'), store = gatedStore(32);
  const first = new Error('first road write'), later = new Error('later road write');
  store.store.put = (_hash, bytes) => {
    const data = decodeRoadTile(bytes), x = data.plan.bins[0]?.tile?.x; data.geometry.dispose();
    return x === 0 ? Promise.reject(first) : x === 2 ? Promise.reject(later) : Promise.resolve(true);
  };
  const backing = new RoadTileBacking(scope, store.store, { pitch: 125, plans: new Map() });
  const work = capture(backing, f.mesh, f.plan), refused = expect(work).rejects.toBe(first);
  await store.started; store.release(); await refused;
  expect(store.counts.reads).toBe(32); expect(store.counts.active).toBe(0);
  expect(store.counts.releases).toBe(store.counts.pins); expect(backing.state().materials).toBe(0);
  scope.dispose(); f.close();
});

test.each(['clean', 'repair', 'quota'] as const)('equal cold hashes preserve later body verification and %s semantics', async mode => {
  const f = fixture(1), scope = new Scope('equal road hashes');
  const plan: CullPlan = { ...f.plan, source: f.plan.source.subarray(0, 3), lod: [],
    bins: f.plan.bins.map(bin => ({ ...bin, levels: [] })) };
  const expected = await serialBodies(f.mesh, plan); expect(expected.size).toBe(1);
  const bodies = new Map<string, Uint8Array>(); let reads = 0, writes = 0, hashes = 0;
  let release = (): void => undefined, hashed = (): void => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const bothHashed = new Promise<void>(resolve => { hashed = resolve; });
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
    const result = await digest(algorithm, data); hashes++; if (hashes === 2) hashed(); return result;
  });
  const backing = new RoadTileBacking(scope, {
    get: async hash => { reads++; const bytes = bodies.get(hash)?.slice() ?? null; if (reads === 1) await gate; return bytes; },
    put: (hash, bytes) => {
      writes++; if (writes > 1 && mode !== 'repair') return Promise.resolve(false);
      const copy = bytes.slice(), last = copy.length - 1;
      if (writes === 1 && mode !== 'clean') copy[last] = (copy[last] ?? 0) ^ 1;
      bodies.set(hash, copy); return Promise.resolve(true);
    },
  }, { pitch: 125, plans: new Map() });
  const work = capture(backing, f.mesh, plan);
  const result = (async () => {
    try { await work; return { ok: true }; }
    catch (error) { return { ok: false, error }; }
  })();
  try {
    await bothHashed; await Promise.resolve(); await Promise.resolve();
    const beforeRelease = reads; release(); const completed = await result;
    expect(beforeRelease).toBe(1); expect(reads).toBe(2); expect(hashes).toBe(3);
    expect(writes).toBe(mode === 'clean' ? 1 : 2);
    if (mode === 'quota') expect(completed).toEqual({ ok: false, error: new Error('Road tile archive storage refused') });
    else {
      expect(completed).toEqual({ ok: true });
      for (const [hash, bytes] of expected) expect(bodies.get(hash)).toEqual(bytes);
    }
  } finally { release(); await result; spy.mockRestore(); scope.dispose(); f.close(); }
});

test('the unchanged 25 MB scratch bound limits medium archives before the job-count window', async () => {
  // For these original float3 sources, each fine archive charges 4,105,704
  // bytes: six fit in 25 MB, the seventh does not. This is below 32 jobs.
  const f = fixture(8, 8001), scope = new Scope('road byte window'), store = gatedStore(6);
  const expected = await serialBodies(f.mesh, f.plan);
  const backing = new RoadTileBacking(scope, store.store, { pitch: 125, plans: new Map() });
  const work = capture(backing, f.mesh, f.plan);
  try {
    await store.started; expect(store.counts.reads).toBe(6); expect(store.counts.active).toBe(6);
  } finally { store.release(); await work; scope.dispose(); f.close(); }
  expect(store.counts.active).toBe(0);
  expect([...store.bodies.keys()].sort()).toEqual([...expected.keys()].sort());
  for (const [hash, bytes] of expected) expect(store.bodies.get(hash)).toEqual(bytes);
});

test('presenting pages keep the original six active archives', async () => {
  const f = fixture(), scope = new Scope('live road window'), store = gatedStore(6);
  const clock = vi.spyOn(performance, 'now').mockReturnValue(1000); noteFrameDrawn(1000);
  const backing = new RoadTileBacking(scope, store.store, { pitch: 125, plans: new Map() });
  const work = capture(backing, f.mesh, f.plan);
  try {
    await store.started; expect(store.counts.reads).toBe(6); expect(store.counts.active).toBe(6);
  } finally {
    store.release();
    try { await work; }
    finally { scope.dispose(); f.close(); noteFrameDrawn(Number.NEGATIVE_INFINITY); clock.mockRestore(); }
  }
  expect(store.counts.peak).toBe(6); expect(store.counts.active).toBe(0); expect(store.counts.reads).toBe(16);
});

test('a retired whole-road mesh draws in no view, its tile pool still does (RP4)', () => {
  // three links a program in setProgram before it reads the draw count: the retired whole mesh (no attributes, an empty
  // range) linked a flat-shaded, position-less variant of each road material on the first frame it was drawn, and again
  // whenever the light count moved (Driftwood's west edge: 3 links, 386 ms in Chromium)
  const f = fixture(), child = new Mesh(new BufferGeometry(), f.mesh.material);
  f.mesh.add(child);
  const previous = retireWholeRoadMesh(f.mesh);
  expect(previous.getAttribute('position')).toBeDefined();
  expect(f.mesh.geometry.drawRange.count).toBe(0);
  expect(f.mesh.layers.test(new PerspectiveCamera().layers)).toBe(false);
  expect(f.mesh.layers.test(new OrthographicCamera().layers)).toBe(false);
  expect(child.layers.test(new PerspectiveCamera().layers)).toBe(true);
  expect(child.parent).toBe(f.mesh);
  previous.dispose(); f.close();
});
