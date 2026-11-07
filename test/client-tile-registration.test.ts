import type { Object3D } from 'three';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { Scope, disposalErrorMessages } from '../src/shared/engine/app/scope';
import { standaloneClientTiles } from '../src/client/game/shardfile/tileContent';
import { tileOf, tileOrder } from '../src/shared/game/shardfile/tileOrder';
import { jsonSlot } from '../src/client/engine/saves/slots';
import { LEVEL_DOWNLOAD_SLOT, runtimePacksOn } from '../src/client/engine/boot/loadingPacks';
import { camera, clientTileFixture as fixture } from './fixtures/clientTileRegistration';

// These original device-ring/retirement rulers exercise the maintained loose-file
// harness path. The shipped packs default has its own whole-cell entry rulers.
const download = jsonSlot(LEVEL_DOWNLOAD_SLOT, 'device'), previous = download.read();
beforeAll(() => { download.write('shardfile'); expect(runtimePacksOn()).toBe(false); });
afterAll(() => { download.write(previous); });

test('initial readiness waits for complete coverage, then releases every claim', async () => {
  const f = fixture(true, false, true);
  const coverageReady = f.registration.coverageReady;
  if (coverageReady === undefined) throw new Error('Missing native coverage readiness');
  try {
    await f.drive();
    let ready = false;
    const pending = f.registration.enter('home', f.entered, f.resident, camera).then(world => {ready = true; return world;});
    await f.drive();
    // Native cancellation can replace a queued prepare; every outstanding
    // distant prepare is held, regardless of how many callbacks were issued.
    expect(f.distant()).toBeGreaterThan(0);
    expect(ready).toBe(false);
    expect(coverageReady('home')).toBe(false);
    f.releaseDistant(); await f.drive(); await pending;
    expect(coverageReady('home')).toBe(true);
    expect(f.coverage(f.entered.root)).toEqual(Array.from({length: 64}, () => 1));
  } finally {f.scope.dispose();}
  expect(f.pins()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test('initial entry and a later return both wait for full coverage', async () => {
  const f = fixture(true, false, true);
  try {
    const initial = f.registration.enter('home', f.entered, f.resident, camera);
    await f.drive();
    f.releaseDistant(); await f.drive(); await initial;
    f.resident.dispose(); await f.drive();
    const returning = f.make('returning'), owner = f.scope.child('returning');
    let ready = false;
    const pending = f.registration.enter('home', returning, owner, camera).then(world => {ready = true; return world;});
    await f.drive();
    expect(f.distant()).toBeGreaterThan(0); expect(ready).toBe(false);
    f.releaseDistant(); await f.drive(); await pending;
    expect(f.coverage(returning.root)).toEqual(Array.from({length: 64}, () => 1));
    owner.dispose();
  } finally {f.scope.dispose();}
  expect(f.pins()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test('a whole-cell home holds every fine tile before entry resolves (DL17)', async () => {
  const f = fixture(true, false, false, true), required = vi.spyOn(f.streamer, 'require');
  try {
    const pending = f.registration.enter('home', f.entered, f.resident, camera);
    await f.drive(); const world = await pending;
    expect(world.fine.size).toBe(64);
    expect([...required.mock.calls[2]?.[1] ?? []]).toHaveLength(64);
    // pinned until the owner leaves: walking to the far corner retires none of them
    await f.drive({ x: 240, z: 240, vx: 0, vz: 0 }); expect(world.fine.size).toBe(64);
  } finally { required.mockRestore(); f.scope.dispose(); }
  expect(f.pins()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test('entry keeps the original mandatory-tile refusal and cleanup', async () => {
  const f = fixture(true, true);
  try {
    const refused = expect(f.registration.enter('home', f.entered, f.resident, camera)).rejects.toThrow('Fixture preparation refused');
    await f.drive(); await refused;
    expect(f.registration.owns('home')).toBe(false);
    expect(f.instances.get('home')).toBe(f.neighbour);
  } finally {f.scope.dispose();}
  expect(f.pins()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test('entered tiles use the existing streamer, keep coarse coverage and restore the newest neighbour root', async () => {
  const f = fixture();
  try {
    await f.drive(); const pending = f.registration.enter('home', f.entered, f.resident, camera);
    await f.drive(); const world = await pending;
    expect(f.registration.owns('home')).toBe(true); expect(f.neighbour.root.children).toHaveLength(0);
    expect(f.coverage(f.entered.root)).toEqual(Array.from({ length: 64 }, () => 1)); expect(world.fine.size).toBe(9);
    const newest = f.make('newest'); f.registration.offer('home', newest);
    expect(f.instances.get('home')?.root).toBe(f.entered.root);
    f.radius(2); await world.refresh(); await f.drive(camera, () => { expect(f.coverage(f.entered.root)).toEqual(Array.from({ length: 64 }, () => 1)); });
    expect(world.fine.size).toBe(25);
    f.resident.dispose(); expect(f.registration.owns('home')).toBe(false); expect(f.entered.root.children).toHaveLength(0);
    expect(f.instances.get('home')?.root).toBe(newest.root); await f.drive(); expect(newest.root.children.length).toBeGreaterThan(0);
  } finally { f.scope.dispose(); }
  expect(f.pins()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test('a missing occupied coarse parent refuses before resident registration after T8', async () => {
  const f = fixture(false);
  try {
    await expect(f.registration.enter('home', f.entered, f.resident, camera)).rejects.toThrow('T8 coarse parent');
    expect(f.registration.owns('home')).toBe(false);
    expect(f.instances.get('home')).toBe(f.neighbour);
    expect(f.entered.root.children).toHaveLength(0);
    expect(f.pins()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
  } finally { f.scope.dispose(); }
  expect(f.pins()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test('an empty coarse row cannot cover an occupied fine tile after T10', async () => {
  const f = fixture();
  for (const row of f.entered.source.tiles) if (row.lod === 1) { row.draws = 0; row.triangles = 0; }
  try {
    await expect(f.registration.enter('home', f.entered, f.resident, camera)).rejects.toThrow('T8 coarse parent');
    expect(f.registration.owns('home')).toBe(false);
    expect(f.instances.get('home')).toBe(f.neighbour);
    expect(f.entered.root.children).toHaveLength(0);
    expect(f.pins()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
  } finally { f.scope.dispose(); }
  expect(f.pins()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test('data entry waits for offered near coverage and retires with its regional owner', async () => {
  const f = fixture();
  try {
    await expect(f.registration.enterOffered('unknown', f.resident, camera)).rejects.toThrow('not been admitted');
    f.registration.offer('home', f.entered);
    let ready = false;
    const pending = f.registration.enterOffered('home', f.resident, camera).then(() => { ready = true; return undefined; });
    expect(ready).toBe(false);
    for (let frame = 0; frame < 10; frame++) { f.streamer.step(camera); await Promise.resolve(); }
    expect(ready).toBe(false);
    await f.drive(); await pending;
    expect(f.registration.owns('home')).toBe(true);
    expect(f.coverage(f.entered.root)).toEqual(Array.from({ length: 64 }, () => 1));
    f.resident.dispose();
    expect(f.registration.owns('home')).toBe(false);
    expect(f.entered.root.children).toHaveLength(0);
    const returned = f.scope.child('returned');
    const again = f.registration.enterOffered('home', returned, camera);
    await f.drive(); await again;
    expect(f.coverage(f.entered.root)).toEqual(Array.from({ length: 64 }, () => 1));
  } finally { f.scope.dispose(); }
  expect(f.pins()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test('data entry keeps preparation refusal and closed-owner fences', async () => {
  const f = fixture(true, true);
  try {
    f.registration.offer('home', f.entered);
    const pending = f.registration.enterOffered('home', f.resident, camera);
    const refusal = expect(pending).rejects.toThrow('Fixture preparation refused');
    await f.drive(); await refusal;
    expect(f.registration.owns('home')).toBe(false);
    f.resident.dispose();
    await expect(f.registration.enterOffered('home', f.resident, camera)).rejects.toThrow('owner left');
  } finally { f.scope.dispose(); }
  expect(f.pins()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test('data entry retains already uploaded neighbour tiles instead of reloading them', async () => {
  const f = fixture();
  try {
    await f.drive();
    const roots = f.neighbour.root.children.filter(root => root.name.includes(':l1/'));
    expect(roots.length).toBeGreaterThan(0);
    const pending = f.registration.enterOffered('home', f.resident, camera);
    for (const root of roots) expect(root.parent).toBe(f.neighbour.root);
    await f.drive(); await pending;
    for (const root of roots) expect(root.parent).toBe(f.neighbour.root);
    expect(f.coverage(f.neighbour.root)).toEqual(Array.from({ length: 64 }, () => 1));
  } finally { f.scope.dispose(); }
  expect(f.pins()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test('failed preparation and page disposal release registrations and their real leases', async () => {
  const f = fixture(true, true);
  try {
    const pending = f.registration.enter('home', f.entered, f.resident, camera), refused = expect(pending).rejects.toThrow('Fixture preparation refused');
    await f.drive(); await refused;
    expect(f.registration.owns('home')).toBe(false); expect(f.instances.get('home')?.root).toBe(f.neighbour.root);
    expect(f.entered.root.children).toHaveLength(0);
  } finally { f.scope.dispose(); }
  expect(f.pins()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test('pending retirement refuses readiness, restores ownership and cannot publish late work', async () => {
  const f = fixture();
  try {
    const pending = f.registration.enter('home', f.entered, f.resident, camera), refused = expect(pending).rejects.toThrow('released');
    f.resident.dispose(); await refused; await f.drive();
    expect(f.entered.root.children).toHaveLength(0); expect(f.instances.get('home')?.root).toBe(f.neighbour.root);
    const closed = new Scope('closed'); closed.dispose();
    await expect(f.registration.enter('home', f.entered, closed, camera)).rejects.toThrow('owner left');
  } finally { f.scope.dispose(); }
  expect(f.pins()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test('standalone publication uses the same leased ports, then advances only from its late callback', async () => {
  const f = fixture(), library = { tiles: new Map<string, Object3D>(), panels: new Map<string, Object3D>(), models: new Map<string, Object3D>(), far: null, disposeTile: () => undefined };
  let late: (() => void) | undefined, pauses = 0;
  try {
    const world = await standaloneClientTiles(f.entered, f.scope, {
      instance: 'solo', budget: { reserve: claim => f.allocator.reserve(claim), now: () => 0 }, start: camera, radius: () => 1,
      library: () => Promise.resolve(library), viewer: () => camera, frame: run => { late = run; },
      pause: () => { if (++pauses > 300) throw new Error('Fixture failed to settle'); return Promise.resolve(); },
    });
    expect(pauses).toBeGreaterThan(0); expect(world.props).toBe(library); expect(world.fine.size).toBe(9);
    expect(f.coverage(f.entered.root)).toEqual(Array.from({ length: 64 }, () => 1));
    expect(f.allocator.entries().filter(row => row.category === 'l1')).toHaveLength(16);
    if (late === undefined) throw new Error('Missing standalone frame callback');
    for (let frame = 0; frame < 25; frame++) {
      const before = f.entered.root.children.length;
      late(); await Promise.resolve();
      expect(f.entered.root.children.length - before).toBeLessThanOrEqual(1);
    }
    f.scope.dispose(); late(); expect(f.entered.root.children).toHaveLength(0);
  } finally { f.scope.dispose(); }
  expect(f.pins()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test('standalone budget refusal fails immediately and releases its half-built owner', async () => {
  const f = fixture(), baseline = f.scope.census;
  let pauses = 0, libraryClosed = false;
  try {
    await expect(standaloneClientTiles(f.entered, f.scope, {
      instance: 'solo', budget: { reserve: () => null, now: () => 0 }, start: camera, radius: () => 1,
      library: owner => { owner.onDispose(() => { libraryClosed = true; }); return Promise.resolve(null); },
      viewer: () => camera, frame: () => { throw new Error('Failed owner must not register a frame'); },
      pause: () => { pauses++; return Promise.resolve(); },
    })).rejects.toThrow('Home tile residency admission deferred');
    expect(pauses).toBe(1); expect(libraryClosed).toBe(true); expect(f.scope.census).toEqual(baseline);
  } finally { f.scope.dispose(); }
  expect(f.pins()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test('standalone parent retirement during loading forbids later publication or frame registration', async () => {
  const f = fixture();
  try {
    await expect(standaloneClientTiles(f.entered, f.scope, {
      instance: 'solo', budget: { reserve: claim => f.allocator.reserve(claim), now: () => 0 }, start: camera, radius: () => 1,
      library: () => Promise.resolve(null), viewer: () => camera,
      frame: () => { throw new Error('Retired owner must not register a frame'); },
      pause: () => { f.scope.dispose(); return Promise.resolve(); },
    })).rejects.toThrow('Standalone tile owner left');
    expect(f.entered.root.children).toHaveLength(0);
  } finally { f.scope.dispose(); }
  expect(f.pins()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test('standalone failure preserves its original error and cleanup diagnostics', async () => {
  const f = fixture();
  try {
    const error: unknown = await standaloneClientTiles(f.entered, f.scope, {
      instance: 'solo', budget: f.allocator, start: camera, radius: () => 1, viewer: () => camera,
      library: owner => { owner.onDispose(() => { throw new Error('Fixture cleanup refused'); }); return Promise.reject(new Error('Fixture library refused')); },
      frame: () => { throw new Error('Failed owner must not register a frame'); }, pause: () => Promise.resolve(),
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(AggregateError);
    expect(disposalErrorMessages(error)).toEqual(['Fixture library refused', 'Fixture cleanup refused']);
  } finally { f.scope.dispose(); }
  expect(f.pins()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test('invalid standalone instance data releases the construction scope before library work', async () => {
  const f = fixture(), baseline = f.scope.census;
  try {
    await expect(standaloneClientTiles(f.entered, f.scope, {
      instance: '', budget: f.allocator, start: camera, radius: () => 1, viewer: () => camera,
      library: () => { throw new Error('Invalid instance must not build a library'); },
      frame: () => { throw new Error('Invalid instance must not register a frame'); }, pause: () => Promise.resolve(),
    })).rejects.toThrow('Invalid ring cells');
    expect(f.scope.census).toEqual(baseline);
  } finally { f.scope.dispose(); }
  expect(f.pins()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});


test('approach pins entry render tiles without entering or replacing the neighbour', async () => {
  const f = fixture(), approach = f.scope.child('approach');
  try {
    const prepare = f.registration.prepareOffered;
    if (prepare === undefined) throw new Error('Missing tile-only approach port');
    const pending = prepare('home', approach, camera);
    expect(f.registration.preparing?.('home')).toBe(true);
    await f.drive(); await pending;
    expect(f.registration.owns('home')).toBe(false);
    expect(f.instances.get('home')?.root).toBe(f.neighbour.root);
    expect(f.entered.root.children).toHaveLength(0);
    expect(f.neighbour.root.children.length).toBeGreaterThan(0);
    approach.dispose();
    expect(f.registration.preparing?.('home')).toBe(false);
    await expect(prepare('home', approach, camera)).rejects.toThrow('owner left');
  } finally { f.scope.dispose(); }
  expect(f.pins()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test('approach pins only its local ring while actual entry retains the full critical set', async () => {
  const f = fixture(), approach = f.scope.child('approach-entryways'), required = vi.spyOn(f.streamer, 'require');
  try {
    const prepare = f.registration.prepareOffered;
    if (prepare === undefined) throw new Error('Missing tile-only approach port');
    const pending = prepare('home', approach, camera);
    expect(required).toHaveBeenCalledTimes(1);
    const spawn = tileOrder(camera), critical = tileOrder(camera, f.neighbour.source.entryways);
    const spawnKeys = spawn.tiles.filter(tile => spawn.rank(tile) === 0).map(tile => tile.j * 8 + tile.i);
    const origin = tileOf(camera.x, camera.z), centre = origin.j * 8 + origin.i;
    expect(required.mock.calls[0]?.[1]).toEqual([centre]);
    await f.drive(); await pending;
    const [first, ring] = required.mock.calls;
    if (first === undefined || ring === undefined) throw new Error('Missing approach phases');
    expect(required).toHaveBeenCalledTimes(2);
    expect([...ring[1]]).toEqual(spawnKeys.filter(key => key !== centre));
    const actual = [...new Set([...first[1], ...ring[1]])].sort((a, b) => a - b);
    expect(actual).toEqual([...spawnKeys].sort((a, b) => a - b));
    const criticalKeys = critical.tiles.filter(tile => critical.rank(tile) === 0).map(tile => tile.j * 8 + tile.i);
    expect(criticalKeys.some(key => !actual.includes(key))).toBe(true);
    expect(f.registration.owns('home')).toBe(false); expect(f.instances.get('home')?.root).toBe(f.neighbour.root);
    approach.dispose(); expect(f.registration.preparing?.('home')).toBe(false);
    const entering = f.registration.enter('home', f.entered, f.resident, camera);
    await f.drive(); await entering;
    expect(required.mock.calls.some(call => call[2] !== 'l1' && criticalKeys.every(key => [...call[1]].includes(key)))).toBe(true);
    expect(f.registration.owns('home')).toBe(true);
  } finally { required.mockRestore(); f.scope.dispose(); }
  expect(f.pins()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test('entry requests its complete critical set immediately after the arrival tile', async () => {
  const f = fixture(), required = vi.spyOn(f.streamer, 'require');
  try {
    const origin = tileOf(camera.x, camera.z), order = tileOrder(camera, f.entered.source.entryways);
    const critical = order.tiles.filter(tile => order.rank(tile) === 0).map(tile => tile.j * 8 + tile.i);
    const preparing = f.registration.enter('home', f.entered, f.resident, camera);
    expect(required.mock.calls[0]?.[1]).toEqual([origin.j * 8 + origin.i]);
    expect(required).toHaveBeenCalledTimes(1);
    await f.drive(); await preparing;
    // A separate local-ring phase would defer the distant entryways again.
    expect(required.mock.calls[1]?.[1]).toEqual(critical);
    expect(required.mock.calls[2]?.[2]).toBe('l1');
    expect(required).toHaveBeenCalledTimes(3);
    expect(f.coverage(f.entered.root)).toEqual(Array.from({ length: 64 }, () => 1));
  } finally { required.mockRestore(); f.scope.dispose(); }
  expect(f.pins()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});
