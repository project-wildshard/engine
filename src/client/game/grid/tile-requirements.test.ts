import { expect, test } from 'vitest';
import { TileStreamer, type RingPorts, type RingLevel } from '@wildshard/engine/world/tileStreamer';
import { ResidencyAllocator } from '../../../shared/game/grid/allocator';

const camera = { x: 10_000, z: 0, vx: 0, vz: 0 };
function fixture(failing?: RingLevel) {
  const allocator = new ResidencyAllocator(), live = new Set<string>(), requests: string[] = [];
  const ports: RingPorts<string> = {
    fetch: (tile, done) => { requests.push(tile.key); done(tile.level === failing ? new Error(`broken ${tile.level}`) : tile.key); },
    upload: tile => { live.add(tile.key); return { mask: () => undefined, shadow: () => undefined, dispose: () => { live.delete(tile.key); } }; },
  };
  const streamer = new TileStreamer([{ instance: 'home', origin: { x: 0, z: 0 } }],
    { reserve: claim => allocator.reserve(claim), now: () => 0 },
    (_instance, level, x, z) => level === 'far' || level === 'l1' && x === 0 && z === 0 || level === 'l0' && x < 2 && z === 0 ? 1000 : null, ports);
  return { streamer, allocator, live, requests };
}

test('pins outside the view wait for parent-first publication, then release to baseline', async () => {
  const f = fixture(), pinned = f.streamer.require('home', [0]); let ready = false;
  void pinned.ready.then(() => { ready = true; return undefined; });
  try {
    for (let step = 0; step < 3; step++) {
      f.streamer.step(camera); await Promise.resolve();
      expect(ready).toBe(step === 2);
    }
    expect(f.requests).toEqual(['home:far', 'home:l1/0/0', 'home:l0/0/0']);
    expect(f.allocator.entries()).toHaveLength(3);
    pinned.release(); pinned.release();
    f.streamer.step(camera);
    expect(f.live.size).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
  } finally { f.streamer.dispose(); }
});

test('overlapping callers retain shared demand after a pending caller releases', async () => {
  const f = fixture(), first = f.streamer.require('home', [0, 0]), second = f.streamer.require('home', [0, 1]);
  const refused = expect(first.ready).rejects.toThrow('released');
  first.release(); await refused;
  try {
    for (let step = 0; step < 4; step++) f.streamer.step(camera);
    await second.ready;
    expect(f.live.has('home:l0/0/0')).toBe(true); expect(f.live.has('home:l0/1/0')).toBe(true);
    expect(f.requests.filter(key => key === 'home:l0/0/0')).toHaveLength(1);
    second.release(); f.streamer.step(camera);
    expect(f.allocator.entries()).toHaveLength(0);
  } finally { f.streamer.dispose(); }
});

test.each(['far', 'l1', 'l0'] as const)('a failed %s rejects dependent readiness and releases pins', async failing => {
  const f = fixture(failing), pin = f.streamer.require('home', [0]);
  const rejected = expect(pin.ready).rejects.toThrow(`broken ${failing}`);
  try {
    for (let step = 0; step < 5; step++) f.streamer.step(camera);
    await rejected;
    expect(f.allocator.entries()).toHaveLength(0);
    const requested = [...f.requests]; f.streamer.step(camera); expect(f.requests).toEqual(requested);
  } finally { f.streamer.dispose(); }
});

test('retirement rejects pending requirements and late release is harmless', async () => {
  const f = fixture(), pin = f.streamer.require('home', [0]);
  const rejected = expect(pin.ready).rejects.toThrow('disposed');
  f.streamer.dispose(); await rejected; pin.release();
  expect(f.allocator.entries()).toHaveLength(0);
  expect(() => f.streamer.require('home', [0])).toThrow('disposed');
});

test('empty catalogue tiles resolve without allocation and invalid rows refuse before pinning', async () => {
  const f = fixture();
  try {
    const empty = f.streamer.require('home', [63]); await empty.ready; f.streamer.step(camera); empty.release();
    expect(f.requests).toEqual([]); expect(f.allocator.entries()).toHaveLength(0);
    for (const keys of [[0, -1], [64], [0.5], [Number.NaN]]) expect(() => f.streamer.require('home', keys)).toThrow('Invalid required tile key');
    expect(() => f.streamer.require('missing', [])).toThrow('Unknown ring cell');
    f.streamer.step(camera); expect(f.requests).toEqual([]);
  } finally { f.streamer.dispose(); }
});

test.each(['fetch', 'upload'] as const)('a synchronous %s refusal rejects readiness and frees admission', async phase => {
  const allocator = new ResidencyAllocator();
  const streamer = new TileStreamer([{ instance: 'home', origin: { x: 0, z: 0 } }],
    { reserve: claim => allocator.reserve(claim), now: () => 0 }, () => 1000, {
      fetch: (tile, done) => { if (phase === 'fetch') throw new Error('broken publication'); done(tile.key); },
      upload: () => { throw new Error('broken publication'); },
    });
  const required = streamer.require('home', [0]), rejected = expect(required.ready).rejects.toThrow('broken publication');
  try { expect(() => streamer.step(camera)).toThrow('broken publication'); await rejected; }
  finally { streamer.dispose(); }
  expect(allocator.entries()).toHaveLength(0);
});

test('coarse requirements retain coverage without requesting fine children', async () => {
  const f = fixture(), pin = f.streamer.require('home', [0], 'l1');
  try {
    for (let step = 0; step < 2; step++) f.streamer.step(camera);
    await pin.ready;
    expect(f.requests).toEqual(['home:far', 'home:l1/0/0']);
    expect(f.live.has('home:l0/0/0')).toBe(false);
    pin.release(); f.streamer.step(camera);
    expect(f.allocator.entries()).toHaveLength(0);
    for (const keys of [[16], [-1], [0.5], [Number.NaN]]) expect(() => f.streamer.require('home', keys, 'l1')).toThrow('Invalid required tile key');
  } finally { pin.release(); f.streamer.dispose(); }
});

test('failed coarse publication rejects coarse and fine requirements together', async () => {
  const f = fixture('l1'), coarse = f.streamer.require('home', [0], 'l1'), fine = f.streamer.require('home', [0]);
  const rejected = Promise.all([expect(coarse.ready).rejects.toThrow('broken l1'), expect(fine.ready).rejects.toThrow('broken l1')]);
  try {
    for (let step = 0; step < 5; step++) f.streamer.step(camera);
    await rejected; expect(f.allocator.entries()).toHaveLength(0);
  } finally { coarse.release(); fine.release(); f.streamer.dispose(); }
});

test('required entry preempts an unrelated stalled fetch without exceeding its slot cap', async () => {
  const allocator = new ResidencyAllocator(), cancelled: string[] = [], discarded: string[] = [];
  const blocked: ((result: string | Error) => void)[] = [];
  const streamer = new TileStreamer([{ instance: 'background', origin: { x: 0, z: 0 } }, { instance: 'entry', origin: { x: 1000, z: 0 } }],
    { reserve: claim => allocator.reserve(claim), now: () => 0 },
    (_instance, level, x, z) => level === 'far' || x === 0 && z === 0 ? 1000 : null, {
      fetch: (tile, done) => { if (tile.instance === 'background' && tile.level !== 'far') blocked.push(done); else done(tile.key); },
      cancel: tile => { cancelled.push(tile.key); },
      discard: tile => { discarded.push(tile.key); },
      upload: () => ({ mask: () => undefined, shadow: () => undefined, dispose: () => undefined }),
    }, { maxInFlight: 1, uploadsPerFrame: 1, viewDistance: 2000 });
  let pin: ReturnType<typeof streamer.require> | undefined;
  try {
    const at = { x: 0, z: 0, vx: 0, vz: 0 };
    for (let frame = 0; frame < 3; frame++) streamer.step(at);
    expect(blocked).toHaveLength(1);
    pin = streamer.require('entry', [0]); let ready = false;
    void pin.ready.then(() => { ready = true; return undefined; }, () => undefined);
    for (let frame = 0; frame < 5; frame++) { streamer.step(at); await Promise.resolve(); expect(streamer.stats().inFlight).toBeLessThanOrEqual(1); }
    expect(ready).toBe(true);
    expect(cancelled).toContain('background:l1/0/0');
    expect(cancelled).not.toContain('entry:far');
    expect(streamer.resident()).toContain('entry:l0/0/0');
    const late = blocked[0]; if (late === undefined) throw new Error('Missing blocked fetch');
    late('late background result'); streamer.step(at);
    expect(discarded).toContain('background:l1/0/0');
  } finally { pin?.release(); streamer.dispose(); }
  expect(allocator.entries()).toHaveLength(0);
});
