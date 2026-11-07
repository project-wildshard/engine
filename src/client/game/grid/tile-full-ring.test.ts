import { expect, test } from 'vitest';
import { TileStreamer, type RingCatalogue, type RingCell, type RingTile } from '@wildshard/engine/world/tileStreamer';
import { onFault, type Fault } from '@wildshard/engine/core/faults';
import { ResidencyAllocator } from '../../../shared/game/grid/allocator';

const camera = { x: -31.25, z: -31.25, vx: 0, vz: 0 };
const home: RingCell = { instance: 'home', origin: { x: 0, z: 0 } };
function fixture(cell: RingCell = home, refuseFine = false, revision?: () => number) {
  const allocator = new ResidencyAllocator(), live = new Map<string, RingTile>(), masks = new Map<string, Set<number>>();
  const catalogue: RingCatalogue = Object.assign(() => 1000, revision === undefined ? {} : { revision });
  const streamer = new TileStreamer([cell], { now: () => 0, reserve: claim => refuseFine && claim.category === 'l0' ? null : allocator.reserve(claim) },
    catalogue, {
      fetch: (tile, done) => { done(tile); },
      upload: tile => { live.set(tile.key, tile); return {
        mask: excluded => { masks.set(tile.key, new Set(excluded)); }, shadow: () => undefined,
        dispose: () => { live.delete(tile.key); masks.delete(tile.key); },
      }; },
    });
  const fine = (): number[] => [...live.values()].filter(tile => tile.level === 'l0').map(tile => tile.z * 8 + tile.x).sort((a, b) => a - b);
  const settle = (view = camera, player: { readonly x: number; readonly z: number } = view): void => {
    for (let step = 0; step < 90; step++) streamer.step(view, player);
  };
  return { streamer, allocator, live, masks, fine, settle };
}

function square(x: number, z: number, radius: number): number[] {
  const keys: number[] = [];
  for (let j = Math.max(0, z - radius); j <= Math.min(7, z + radius); j++)
    for (let i = Math.max(0, x - radius); i <= Math.min(7, x + radius); i++) keys.push(j * 8 + i);
  return keys;
}

test('full detail changes 5x5 to whole to 3x3 without retaining unwanted fine tiles', () => {
  const f = fixture();
  try {
    f.streamer.setFullRing('home', 2); f.settle(); expect(f.fine()).toEqual(square(3, 3, 2));
    f.streamer.setFullRing('home', 8); f.settle(); expect(f.fine()).toHaveLength(64);
    expect(f.allocator.entries().filter(row => row.category === 'l0')).toHaveLength(64);
    f.streamer.setFullRing('home', 1); f.streamer.step(camera);
    expect(f.fine()).toEqual(square(3, 3, 1));
    expect(f.allocator.entries().filter(row => row.category === 'l0')).toHaveLength(9);
    // A retired child exposes its parent's quadrant in the same step.
    expect(f.masks.get('home:l1/0/0')).toEqual(new Set());
  } finally { f.streamer.dispose(); }
  expect(f.live.size).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test('player centre wins over an orbit camera, with four metres of boundary hysteresis', () => {
  const f = fixture(), orbit = { ...camera, x: 20, z: 20 };
  try {
    f.streamer.setFullRing('home', 0); f.settle(orbit, { x: -2, z: -31.25 }); expect(f.fine()).toEqual([27]);
    f.settle(orbit, { x: 2, z: -31.25 }); expect(f.fine()).toEqual([27]);
    f.settle(orbit, { x: 4, z: -31.25 }); expect(f.fine()).toEqual([28]);
    f.settle(orbit, { x: -2, z: -31.25 }); expect(f.fine()).toEqual([28]);
    f.settle(orbit, { x: -4.01, z: -31.25 }); expect(f.fine()).toEqual([27]);
  } finally { f.streamer.dispose(); }
});

test('full-ring pins stay additive until released, then distance mode can resume', async () => {
  const f = fixture();
  f.streamer.setFullRing('home', 0);
  const pin = f.streamer.require('home', [63]);
  try {
    f.settle(); await pin.ready; expect(f.fine()).toEqual([27, 63]);
    pin.release(); f.streamer.step(camera); expect(f.fine()).toEqual([27]);
    f.streamer.setFullRing('home', null); f.settle(); expect(f.fine().length).toBeGreaterThan(1);
  } finally { pin.release(); f.streamer.dispose(); }
});

test.each([
  { type: 'road', width: 55, depth: 500, expected: [8, 16, 24, 32, 40] },
  { type: 'junction', width: 55, depth: 55, expected: [0] },
] as const)('full rings clip to declared $type dimensions', ({ type, width, depth, expected }) => {
  const f = fixture({ instance: 'home', origin: { x: 0, z: 0 }, type, extent: { width, depth } });
  try { f.streamer.setFullRing('home', 2); f.settle(); expect(f.fine()).toEqual(expected); }
  finally { f.streamer.dispose(); }
});

test('full selection never bypasses native budget refusal', () => {
  const f = fixture(undefined, true);
  try { f.streamer.setFullRing('home', 8); f.settle(); expect(f.fine()).toEqual([]); expect(f.streamer.stats().refused).toBeGreaterThan(0); }
  finally { f.streamer.dispose(); }
  expect(f.allocator.entries()).toHaveLength(0);
});

test('invalid authored rings refuse before changing demand', () => {
  const f = fixture();
  try {
    for (const radius of [-1, 0.5, 9, Number.NaN, Infinity]) expect(() => f.streamer.setFullRing('home', radius)).toThrow('Invalid full tile ring');
    expect(() => f.streamer.setFullRing('missing', 2)).toThrow('Unknown ring cell');
    expect(f.allocator.entries()).toHaveLength(0);
  } finally { f.streamer.dispose(); }
  expect(() => f.streamer.setFullRing('home', 1)).toThrow('disposed');
});

test.each(['x', 'z', 'vx', 'vz', 'centre.x', 'centre.z'] as const)('a nonfinite %s skips only that frame and reports once', field => {
  const f = fixture(), faults: Fault[] = [], off = onFault(fault => { faults.push(fault); });
  try {
    f.streamer.setFullRing('home', 1); f.settle();
    const before = { stats: f.streamer.stats(), resident: f.streamer.resident(), entries: f.allocator.entries(), masks: [...f.masks] };
    const invalidCamera = field === 'centre.x' || field === 'centre.z' ? camera : { ...camera, [field]: Number.NaN };
    const invalidCentre = field === 'centre.x' ? { x: Infinity, z: 0 } : field === 'centre.z' ? { x: 0, z: -Infinity } : camera;
    for (let frame = 0; frame < 4; frame++) f.streamer.step(invalidCamera, invalidCentre);
    expect({ stats: f.streamer.stats(), resident: f.streamer.resident(), entries: f.allocator.entries(), masks: [...f.masks] }).toEqual(before);
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({ system: 'world.tiles', verdict: 'retry', error: { message: 'Invalid ring camera' } });
    f.settle({ ...camera, x: 31.25 });
    expect(f.streamer.stats().frame).toBeGreaterThan(before.stats.frame);
    expect(f.fine()).toEqual(square(4, 3, 1));
    expect(faults).toHaveLength(1);
  } finally { off(); f.streamer.dispose(); }
});

test('an invalid catalogue revision cannot advance the frame or change residency and recovers', () => {
  let revision = 0;
  const f = fixture(home, false, () => revision), faults: Fault[] = [], off = onFault(fault => { faults.push(fault); });
  try {
    f.streamer.setFullRing('home', 1); f.settle();
    const before = { stats: f.streamer.stats(), resident: f.streamer.resident(), entries: f.allocator.entries() };
    revision = Number.NaN;
    f.streamer.step({ ...camera, x: 31.25 }); f.streamer.step(camera);
    expect({ stats: f.streamer.stats(), resident: f.streamer.resident(), entries: f.allocator.entries() }).toEqual(before);
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({ verdict: 'retry', error: { message: 'Invalid ring catalogue revision' } });
    revision = 1; f.settle({ ...camera, x: 31.25 });
    expect(f.fine()).toEqual(square(4, 3, 1)); expect(faults).toHaveLength(1);
  } finally { off(); f.streamer.dispose(); }
});

test('a late retired frame reports once without reviving any tile or lease', () => {
  const f = fixture(), faults: Fault[] = [], off = onFault(fault => { faults.push(fault); });
  try {
    f.settle(); f.streamer.dispose(); const before = f.streamer.stats();
    f.streamer.step(camera); f.streamer.step(camera);
    expect(f.streamer.stats()).toEqual(before); expect(f.allocator.entries()).toEqual([]); expect(f.live.size).toBe(0);
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatchObject({ verdict: 'retry', error: { message: 'Render rings are disposed' } });
  } finally { off(); f.streamer.dispose(); }
});
