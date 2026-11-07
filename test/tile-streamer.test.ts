import { expect, test } from 'vitest';
import { ResidencyAllocator } from '../src/shared/game/grid/allocator';
import { TileStreamer, type RingPorts, type RingTile, type RingLevel, type RingOptions, type TileStreamBudget } from '../src/client/engine/world/tileStreamer';

function drive(fullRing: number | null = null) {
  const cells = [{ instance: 'west', origin: { x: 0, z: 0 } }, { instance: 'east', origin: { x: 555, z: 0 } }];
  const allocator = new ResidencyAllocator(), live = new Map<string, Set<number>>();
  const pending: { tile: RingTile; done: (value: string) => void }[] = [], events: string[] = [];
  const ports: RingPorts<string> = {
    fetch: (tile, done) => { events.push(`fetch:${tile.key}`); pending.push({ tile, done }); },
    upload: tile => { events.push(`upload:${tile.key}`); live.set(tile.key, new Set()); return {
      mask: excluded => { live.set(tile.key, new Set(excluded)); }, shadow: () => undefined,
      dispose: () => { events.push(`dispose:${tile.key}`); live.delete(tile.key); },
    }; },
    cancel: tile => { events.push(`cancel:${tile.key}`); },
    discard: tile => { events.push(`discard:${tile.key}`); },
  };
  const bytes = (_instance: string, level: RingLevel): number => level === 'far' ? 8000 : level === 'l1' ? 2000 : 1000;
  const streamer = new TileStreamer(cells, { reserve: claim => allocator.reserve(claim), now: () => 0 }, bytes, ports);
  if (fullRing !== null) for (const cell of cells) streamer.setFullRing(cell.instance, fullRing);
  let holes = 0, overlaps = 0, readyFrames = 0, fineMost = 0;
  for (let frame = 0; frame <= 120; frame++) {
    if (frame % 3 === 0) for (const row of pending.splice(0)) row.done(row.tile.key);
    // Initial settle, then exactly 1000 metres in 10 m increments.
    const x = -500 + Math.max(0, frame - 20) * 10;
    streamer.step({ x, z: 0, vx: frame > 20 ? 10 : 0, vz: 0 });
    if (streamer.ready()) {
      readyFrames++;
      for (const cell of streamer.visible()) for (let z = 0; z < 8; z++) for (let i = 0; i < 8; i++) {
        const far = live.get(`${cell.instance}:far`), coarse = live.get(`${cell.instance}:l1/${String(Math.floor(i / 2))}/${String(Math.floor(z / 2))}`);
        const full = live.has(`${cell.instance}:l0/${String(i)}/${String(z)}`);
        const count = Number(far !== undefined && !far.has(Math.floor(i / 2) + 4 * Math.floor(z / 2)))
          + Number(coarse !== undefined && !coarse.has(i % 2 + 2 * (z % 2))) + Number(full);
        if (count === 0) holes++; if (count > 1) overlaps++;
      }
    }
    for (const cell of cells) fineMost = Math.max(fineMost, streamer.resident().filter(key => key.startsWith(`${cell.instance}:l0/`)).length);
  }
  streamer.dispose();
  // Fetches finishing after retirement can only discard, never publish a view.
  for (const row of pending.splice(0)) row.done(row.tile.key);
  expect(live.size).toBe(0); expect(allocator.entries()).toHaveLength(0);
  return { holes, overlaps, readyFrames, fineMost };
}

test('the engine drives 1 km with no ready-frame holes or overlaps', () => {
  const result = drive();
  expect(result.holes).toBe(0); expect(result.overlaps).toBe(0);
  expect(result.readyFrames).toBeGreaterThan(100);
});

test('a 5 x 5 full ring keeps at most 25 fine tiles a cell over the same 1 km drive, with no holes (tiles T2)', () => {
  const result = drive(2);
  expect(result.holes).toBe(0); expect(result.overlaps).toBe(0);
  expect(result.readyFrames).toBeGreaterThan(100);
  expect(result.fineMost).toBeGreaterThan(0); expect(result.fineMost).toBeLessThanOrEqual(25);
});

test('invalid cell data refuses before any borrowed render or budget service runs', () => {
  const allocator = new ResidencyAllocator();
  const ports: RingPorts<string> = { fetch: () => { throw new Error('Unexpected fetch'); }, upload: () => { throw new Error('Unexpected upload'); } };
  expect(() => new TileStreamer([{ instance: 'bad', origin: { x: Number.NaN, z: 0 } }], allocator, () => 1, ports)).toThrow('Invalid ring cells');
  expect(allocator.entries()).toHaveLength(0);
});

function timedUploads(cost: number, options: RingOptions = {}) {
  let now = 0;
  const allocator = new ResidencyAllocator();
  const budget: TileStreamBudget = { reserve: claim => allocator.reserve(claim), now: () => now };
  const cells = Array.from({ length: 4 }, (_, index) => ({ instance: `cell${String(index)}`, origin: { x: index * 555, z: 0 } }));
  const drawn = new Set<string>();
  const ports: RingPorts<string> = {
    fetch: (tile, done) => { done(tile.key); },
    upload: tile => { now += cost; drawn.add(tile.key); return {
      mask: () => undefined, shadow: () => undefined, dispose: () => { drawn.delete(tile.key); },
    }; },
  };
  const streamer = new TileStreamer(cells, budget, (_instance, level) => level === 'far' ? 1000 : null, ports,
    { viewDistance: 3000, farRadius: 3000, uploadsPerFrame: 4, uploadBytesPerFrame: 4000, ...options });
  return { streamer, allocator, drawn };
}
const camera = { x: 0, z: 0, vx: 0, vz: 0 };

test.each([false, true])('entry uploads prioritize required parents and restore distance order after release=%s', async released => {
  const allocator = new ResidencyAllocator(), uploads: string[] = [];
  const cells = [{ instance: 'near', origin: { x: 0, z: 0 } }, { instance: 'entry', origin: { x: 555, z: 0 } }];
  const streamer = new TileStreamer(cells, { reserve: claim => allocator.reserve(claim), now: () => 0 },
    (instance, level, x, z) => level === 'far' || instance === 'entry' && level === 'l1' && x === 0 && z === 0 ? 1 : null,
    { fetch: (tile, done) => { done(tile.key); }, upload: tile => {
      uploads.push(tile.key); return { mask: () => undefined, shadow: () => undefined, dispose: () => undefined };
    } }, { viewDistance: 3000, farRadius: 3000, uploadsPerFrame: 1, uploadBytesPerFrame: 1 });
  const required = streamer.require('entry', [0], 'l1');
  try {
    if (released) {
      const refused = expect(required.ready).rejects.toThrow('Tile requirement released');
      required.release(); await refused;
      streamer.step(camera); expect(uploads).toEqual(['near:far']);
    } else {
      streamer.step(camera); expect(uploads).toEqual(['entry:far']);
      // A queued unrelated far tile must not consume the entry child's frame.
      streamer.step(camera); await required.ready;
      expect(uploads).toEqual(['entry:far', 'entry:l1/0/0']);
      required.release(); streamer.step(camera);
      expect(uploads).toEqual(['entry:far', 'entry:l1/0/0', 'near:far']);
    }
  } finally { required.release(); streamer.dispose(); }
  expect(allocator.entries()).toHaveLength(0);
});

test('unchanged parent masks stay quiet and old exclusion sets survive child retirement', async () => {
  const allocator = new ResidencyAllocator(), masks: ReadonlySet<number>[] = [], evictions = new Map<string, () => void>();
  const budget: TileStreamBudget = { reserve: claim => { evictions.set(claim.id, claim.evictSync); return allocator.reserve(claim); } };
  const ports: RingPorts<string> = {
    fetch: (tile, done) => { done(tile.key); },
    upload: tile => ({ mask: excluded => { if (tile.level === 'far') masks.push(excluded); }, shadow: () => undefined, dispose: () => undefined }),
  };
  const streamer = new TileStreamer([{ instance: 'mask-cell', origin: { x: 0, z: 0 } }], budget,
    (_instance, level) => level === 'l0' ? null : 1, ports, { uploadsPerFrame: 32, maxInFlight: 32, uploadMsPerFrame: 1000 });
  try {
    const required = streamer.require('mask-cell', Array.from({ length: 16 }, (_, index) => index), 'l1');
    for (let i = 0; i < 8; i++) streamer.step(camera);
    await required.ready;
    const full = masks.at(-1), original = masks.map(mask => [...mask]);
    expect(full?.size).toBe(16); expect(full?.has(15)).toBe(true);
    for (let i = 0; i < 8; i++) streamer.step(camera);
    expect(masks.map(mask => [...mask])).toEqual(original);
    required.release();
    const retire = evictions.get('render:mask-cell:l1/3/3');
    if (retire === undefined) throw new Error('Missing child eviction');
    retire();
    expect(masks.at(-1)?.size).toBe(15); expect(masks.at(-1)?.has(15)).toBe(false);
    expect(masks.at(-1)).not.toBe(full); expect(full?.size).toBe(16); expect(full?.has(15)).toBe(true);
    expect(masks.slice(0, original.length).map(mask => Array.from(mask))).toEqual(original);
  } finally { streamer.dispose(); }
  expect(allocator.entries()).toEqual([]);
});

test('elapsed uploads pause refinement without dropping its scopes or claims', () => {
  const f = timedUploads(12);
  try {
    f.streamer.step(camera);
    expect(f.streamer.stats()).toMatchObject({ resident: { far: 1 }, queued: 3, uploads: 1 });
    expect(f.allocator.entries()).toHaveLength(4);
    expect(f.streamer.ready()).toBe(false);
    for (let frame = 1; frame < 4; frame++) {
      f.streamer.step(camera);
      expect(f.streamer.stats().uploads).toBe(frame + 1);
    }
    expect(f.streamer.ready()).toBe(true);
  } finally { f.streamer.dispose(); }
  expect(f.drawn.size).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test.each([
  { cost: 1, options: { uploadsPerFrame: 2 }, uploads: 2 },
  { cost: 1, options: { uploadBytesPerFrame: 2000 }, uploads: 2 },
  { cost: 8, options: { uploadMsPerFrame: 8 }, uploads: 1 },
  { cost: 30, options: { uploadMsPerFrame: 12 }, uploads: 1 },
])('count, byte and time limits independently bound new uploads: %o', ({ cost, options, uploads }) => {
  const f = timedUploads(cost, options);
  try { f.streamer.step(camera); expect(f.streamer.stats().uploads).toBe(uploads); }
  finally { f.streamer.dispose(); }
  expect(f.allocator.entries()).toHaveLength(0);
});

test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('invalid time budget %s refuses before preparation', uploadMsPerFrame => {
  expect(() => timedUploads(1, { uploadMsPerFrame })).toThrow('Invalid tile upload time budget');
});

test.each(['nested', 'throw'] as const)('release planning survives %s disposal without changing the remaining order', action => {
  const allocator = new ResidencyAllocator(), disposed: string[] = [];
  let entered = false;
  let nested = (): void => { throw new Error('Missing live streamer'); };
  const ports: RingPorts<string> = {
    fetch: (tile, done) => { done(tile.key); },
    upload: tile => ({ mask: () => undefined, shadow: () => undefined, dispose: () => {
      disposed.push(tile.key);
      if (entered) return;
      entered = true;
      if (action === 'throw') throw new Error('Fixture cleanup failed');
      // This nested camera still wants b/c. The outer release must retain its
      // own plan and finish dropping them in its original distance order.
      nested();
    } }),
  };
  const streamer = new TileStreamer(['a', 'b', 'c'].map((instance, index) => ({ instance, origin: { x: index * 555, z: 0 } })),
    { reserve: claim => allocator.reserve(claim), now: () => 0 }, (_instance, level) => level === 'far' ? 1000 : null, ports,
    { viewDistance: 1500, farRadius: 1500, uploadsPerFrame: 4 });
  nested = () => { streamer.step({ x: 2000, z: 0, vx: 0, vz: 0 }); };
  try {
    streamer.step(camera);
    expect(streamer.resident()).toEqual(['a:far', 'b:far', 'c:far']);
    const away = { x: 10000, z: 0, vx: 0, vz: 0 };
    if (action === 'throw') {
      expect(() => streamer.step(away)).toThrow('Ring tile cleanup failed');
      expect(disposed).toEqual(['a:far']);
    }
    streamer.step(away);
    expect(disposed).toEqual(['a:far', 'b:far', 'c:far']);
    expect(streamer.resident()).toEqual([]);
    expect(allocator.entries()).toEqual([]);
  } finally { streamer.dispose(); }
});

test('replanning keeps fresh public descriptors and rejects an old construction completion', () => {
  const allocator = new ResidencyAllocator(), received: RingTile[] = [], discarded: string[] = [];
  const completions: ((value: string) => void)[] = [];
  const ports: RingPorts<string> = {
    fetch: (tile, done) => { received.push(tile); completions.push(done); done(tile.key); },
    upload: () => ({ mask: () => undefined, shadow: () => undefined, dispose: () => undefined }),
    discard: (_tile, data) => { discarded.push(data); },
  };
  const streamer = new TileStreamer([{ instance: 'home', origin: { x: 0, z: 0 } }],
    { reserve: claim => allocator.reserve(claim), now: () => 0 }, (_instance, level) => level === 'far' ? 1000 : null, ports);
  try {
    streamer.step(camera);
    const original = received[0]; if (original === undefined) throw new Error('Missing original tile');
    Object.defineProperty(original, 'constructionMarker', { value: 1, enumerable: true });
    for (let frame = 0; frame < 5; frame++) streamer.step(camera);
    expect(received).toHaveLength(1);
    streamer.step({ x: 10000, z: 0, vx: 0, vz: 0 });
    streamer.step(camera);
    const next = received[1]; if (next === undefined) throw new Error('Missing replacement tile');
    expect(next).not.toBe(original);
    expect(next).toEqual({ key: 'home:far', instance: 'home', type: 'level', level: 'far', x: 0, z: 0 });
    completions[0]?.('obsolete'); streamer.step(camera);
    expect(discarded).toEqual(['obsolete']);
    expect(streamer.resident()).toEqual(['home:far']);
  } finally { streamer.dispose(); }
  expect(allocator.entries()).toEqual([]);
});

test('required zero keys retain the original Set coordinate canonicalization', async () => {
  const allocator = new ResidencyAllocator(), received: RingTile[] = [];
  const streamer = new TileStreamer([{ instance: 'home', origin: { x: 0, z: 0 } }],
    { reserve: claim => allocator.reserve(claim), now: () => 0 }, (_instance, level) => level === 'l0' ? 1000 : null,
    { fetch: (tile, done) => { received.push(tile); done(tile.key); }, upload: () => ({ mask: () => undefined, shadow: () => undefined, dispose: () => undefined }) });
  const away = { x: 10000, z: 0, vx: 0, vz: 0 };
  try {
    const negative = streamer.require('home', [-0]); streamer.step(away); await negative.ready;
    expect(Object.is(received[0]?.x, 0)).toBe(true); expect(Object.is(received[0]?.z, 0)).toBe(true);
    negative.release(); streamer.step(away);
    const positive = streamer.require('home', [0]); streamer.step(away); await positive.ready;
    expect(received).toHaveLength(2);
    expect(Object.is(received[1]?.x, 0)).toBe(true); expect(Object.is(received[1]?.z, 0)).toBe(true);
    positive.release();
  } finally { streamer.dispose(); }
});

test.each([
  { action: 'nested' },
  { action: 'throw' },
] as const)('catalogue $action keeps the streamer planning and releases every claim', ({ action }) => {
  const allocator = new ResidencyAllocator(), events: string[] = [], rows: unknown[] = [];
  let armed = false, runNested = (): void => undefined;
  const cells = [{ instance: 'west', origin: { x: 0, z: 0 } }, { instance: 'east', origin: { x: 555, z: 0 } }];
  const ports: RingPorts<string> = {
    fetch: (tile, done) => { events.push(`fetch:${tile.key}`); done(tile.key); },
    upload: tile => { events.push(`upload:${tile.key}`); return {
      mask: excluded => { events.push(`mask:${tile.key}:${[...excluded].join(',')}`); }, shadow: () => undefined,
      dispose: () => { events.push(`dispose:${tile.key}`); },
    }; },
    cancel: tile => { events.push(`cancel:${tile.key}`); },
  };
  const streamer = new TileStreamer(cells, { reserve: claim => allocator.reserve(claim), now: () => 0 }, (_instance, level) => {
    if (armed && level === 'l1') { armed = false; if (action === 'throw') throw new Error('Catalogue failed'); runNested(); }
    return level === 'far' ? 8000 : level === 'l1' ? 2000 : 1000;
  }, ports);
  runNested = () => { streamer.step({ x: 555, z: 0, vx: 0, vz: 0 }); };
  try {
    for (let frame = 0; frame < 16; frame++) {
      if (frame === 3) armed = true;
      try { streamer.step({ x: frame * 17, z: frame % 2 === 1 ? 11 : -11, vx: 17, vz: 0 }); }
      catch (error) {
        if (action !== 'throw' || !(error instanceof Error) || error.message !== 'Catalogue failed') throw error;
        events.push('caught');
      }
      rows.push({ resident: streamer.resident(), stats: streamer.stats(), claims: allocator.entries(), events: events.splice(0) });
    }
    expect(rows).toHaveLength(16); expect(JSON.stringify(rows).includes('"caught"')).toBe(action === 'throw');
  } finally { streamer.dispose(); }
  expect(allocator.entries()).toEqual([]);
});

test('revisioned stationary publication stops planning and wakes for costs, pins, movement and eviction', async () => {
  const allocator = new ResidencyAllocator(); let reads = 0, revision = 0, evict = (): void => undefined;
  const catalogue = Object.assign((_instance: string, level: RingLevel): number | null => { reads++; return level === 'far' ? 1 : null; },
    { revision: (): number => revision });
  const streamer = new TileStreamer([{ instance: 'home', origin: { x: 0, z: 0 } }], {
    now: () => 0, reserve: claim => { evict = claim.evictSync; return allocator.reserve(claim); },
  }, catalogue, { fetch: (tile, done) => { done(tile.key); },
    upload: () => ({ mask: () => undefined, shadow: () => undefined, dispose: () => undefined }) });
  const still = { x: 0, z: 0, vx: 0, vz: 0 };
  try {
    for (let i = 0; i < 4; i++) streamer.step(still);
    const settled = reads;
    for (let i = 0; i < 100; i++) streamer.step(still);
    expect(reads).toBe(settled); expect(streamer.stats().frame).toBe(104);
    revision++; streamer.step(still); expect(reads).toBeGreaterThan(settled);
    const changed = reads; streamer.step({ ...still, x: 0.001 }); expect(reads).toBeGreaterThan(changed);
    streamer.step(still); const moved = reads;
    const pin = streamer.require('home', [0]); await pin.ready;
    streamer.step(still); expect(reads).toBeGreaterThan(moved); pin.release(); streamer.step(still);
    const pinned = reads; evict(); streamer.step(still); expect(reads).toBeGreaterThan(pinned);
    expect(streamer.resident()).toContain('home:far');
  } finally { streamer.dispose(); }
});

test('a stationary dynamic catalogue keeps its original polling unless it advertises revisions', () => {
  const allocator = new ResidencyAllocator(); let reads = 0;
  const streamer = new TileStreamer([{ instance: 'home', origin: { x: 0, z: 0 } }],
    { now: () => 0, reserve: claim => allocator.reserve(claim) },
    (_instance, level) => { reads++; return level === 'far' ? 1 : null; },
    { fetch: (tile, done) => { done(tile.key); }, upload: () => ({ mask: () => undefined, shadow: () => undefined, dispose: () => undefined }) });
  try {
    streamer.step({ x: 0, z: 0, vx: 0, vz: 0 }); const before = reads;
    streamer.step({ x: 0, z: 0, vx: 0, vz: 0 }); expect(reads).toBeGreaterThan(before);
  } finally { streamer.dispose(); }
});


test('a revisioned stationary refusal waits only until its original retry frame', () => {
  const allocator = new ResidencyAllocator(); let reads = 0, reserves = 0, refuse = true;
  const catalogue = Object.assign((_instance: string, level: RingLevel): number | null => { reads++; return level === 'far' ? 1 : null; }, { revision: () => 0 });
  const streamer = new TileStreamer([{ instance: 'home', origin: { x: 0, z: 0 } }], {
    now: () => 0, reserve: claim => { reserves++; return refuse ? null : allocator.reserve(claim); },
  }, catalogue, { fetch: (tile, done) => { done(tile.key); },
    upload: () => ({ mask: () => undefined, shadow: () => undefined, dispose: () => undefined }) });
  const still = { x: 0, z: 0, vx: 0, vz: 0 };
  try {
    streamer.step(still); const first = reads;
    for (let i = 0; i < 14; i++) streamer.step(still);
    expect(reads).toBe(first); expect(reserves).toBe(1);
    refuse = false; streamer.step(still);
    expect(reserves).toBe(2); expect(streamer.resident()).toEqual(['home:far']);
  } finally { streamer.dispose(); }
});

test('a stationary fetch waits without replanning and its completion wakes publication', () => {
  const allocator = new ResidencyAllocator(); let reads = 0;
  const pending: ((value: string) => void)[] = [];
  const catalogue = Object.assign((_instance: string, level: RingLevel): number | null => { reads++; return level === 'far' ? 1 : null; }, { revision: () => 0 });
  const streamer = new TileStreamer([{ instance: 'home', origin: { x: 0, z: 0 } }], { now: () => 0, reserve: claim => allocator.reserve(claim) }, catalogue,
    { fetch: (_tile, done) => { pending.push(done); }, upload: () => ({ mask: () => undefined, shadow: () => undefined, dispose: () => undefined }) });
  const still = { x: 0, z: 0, vx: 0, vz: 0 };
  try {
    streamer.step(still); const waiting = reads;
    for (let i = 0; i < 30; i++) streamer.step(still);
    expect(reads).toBe(waiting); expect(streamer.resident()).toEqual([]);
    const finish = pending[0]; if (finish === undefined) throw new Error('Missing fetch');
    finish('home:far'); streamer.step(still);
    expect(reads).toBeGreaterThan(waiting); expect(streamer.resident()).toEqual(['home:far']);
  } finally { streamer.dispose(); }
});


test('published explicit rings tolerate motion only inside their exact geometric certificate', () => {
  const allocator = new ResidencyAllocator(); let reads = 0;
  const catalogue = Object.assign((_id: string, level: RingLevel): number | null => { reads++; return level === 'far' ? null : 1; }, { revision: () => 0 });
  const masks: number[][] = [];
  const streamer = new TileStreamer([{ instance: 'home', origin: { x: 0, z: 0 } }], { now: () => 0, reserve: claim => allocator.reserve(claim) }, catalogue,
    { fetch: (tile, done) => { done(tile.key); }, upload: () => ({ mask: value => { masks.push([...value]); }, shadow: () => undefined, dispose: () => undefined }) });
  const still = { x: 0, z: 0, vx: 0, vz: 0 };
  try {
    streamer.setFullRing('home', 2);
    for (let i = 0; i < 100; i++) streamer.step(still);
    const before = reads, resident = streamer.resident(), maskCount = masks.length;
    for (let i = 0; i < 100; i++) streamer.step({ ...still, x: i / 100000, z: i / 100000 });
    expect(reads).toBe(before); expect(streamer.resident()).toEqual(resident); expect(masks).toHaveLength(maskCount);
    // Four metres is the existing followed-ring hysteresis, not an epsilon.
    streamer.step({ ...still, x: -4.01 }); expect(reads).toBeGreaterThan(before);
    const moved = reads; streamer.setFullRing('home', 1); streamer.step(still); expect(reads).toBeGreaterThan(moved);
  } finally { streamer.dispose(); }
});
