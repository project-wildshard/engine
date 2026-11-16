import { expect, test, vi } from 'vitest';
import { runtimePacksOn } from '../src/client/engine/boot/loadingPacks';
import { CELL_RING, ringRadius } from '../src/client/game/shardfile/tileContent';
import { tileOf, tileOrder } from '../src/shared/game/shardfile/tileOrder';
import { camera, clientTileFixture } from './fixtures/clientTileRegistration';
import { Scope } from '../src/shared/engine/app/scope';
import { ControlRefinement, prepareSpawnView } from '../src/client/game/shardfile/controlRefinement';
import { folderTileRing, TileDriver } from '../src/client/game/shardfile/tileDriver';

test('the shipped packs default holds every fine tile without changing arrival and critical ordering', async () => {
  expect(runtimePacksOn()).toBe(true);
  expect(ringRadius({}, () => 1)).toBe(CELL_RING);
  const f = clientTileFixture(true, false, true, false, { hold: '0/7/7' }), required = vi.spyOn(f.streamer, 'require');
  try {
    const at = tileOf(camera.x, camera.z);
    const order = tileOrder(camera, f.entered.source.entryways);
    const critical = order.tiles.filter(tile => order.rank(tile) === 0).map(tile => tile.j * 8 + tile.i);
    let ready = false;
    const pending = f.registration.enter('home', f.entered, f.resident, camera).then(world => { ready = true; return world; });
    expect(required.mock.calls[0]?.[1]).toEqual([at.j * 8 + at.i]);
    expect(required).toHaveBeenCalledTimes(1);
    await f.drive();
    expect(f.distant()).toBeGreaterThan(0);
    expect(ready).toBe(false);
    expect(f.registration.coverageReady?.('home')).toBe(false);
    f.releaseDistant(); await f.drive(); const world = await pending;
    expect(required.mock.calls[1]?.[1]).toEqual(critical);
    expect([...required.mock.calls[2]?.[1] ?? []]).toHaveLength(64);
    expect(world.fine.size).toBe(64);
    expect(f.registration.coverageReady?.('home')).toBe(true);
    expect(f.coverage(f.entered.root)).toEqual(Array.from({ length: 64 }, () => 1));
    await f.drive({ ...camera, x: 220, z: 220 });
    expect(world.fine.size).toBe(64);
    expect(f.coverage(f.entered.root)).toEqual(Array.from({ length: 64 }, () => 1));
    f.resident.dispose();
    expect(f.registration.owns('home')).toBe(false);
    expect(f.entered.root.children).toHaveLength(0);
  } finally { required.mockRestore(); f.scope.dispose(); }
  expect(f.pins()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test('packs entry visibly refuses a failed fine tile outside the device ring and releases its claims', async () => {
  expect(runtimePacksOn()).toBe(true);
  const f = clientTileFixture(true, true, false, false, { fail: '0/7/7' });
  try {
    const pending = f.registration.enter('home', f.entered, f.resident, camera);
    const refused = expect(pending).rejects.toThrow('Fixture preparation refused');
    await f.drive(); await refused;
    expect(f.registration.owns('home')).toBe(false);
    expect(f.entered.root.children).toHaveLength(0);
  } finally { f.scope.dispose(); }
  expect(f.pins()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test('the packs fence includes distant and high jobs before control', async () => {
  expect(runtimePacksOn()).toBe(true);
  const owner = new Scope('packs.fence'), level = owner.child('level'), seen: string[] = [];
  const queue = new ControlRefinement(owner, level, () => ({ x: 500, z: 0 }), () => Promise.resolve());
  try {
    const jobs = [['spawn', { x: 501, y: 80, z: 0 }], ['origin', { x: 0, y: 0, z: -10 }],
      ['high', { x: 0, y: 500, z: 0 }]] as const;
    const pending = jobs.map(([id, at]) => queue.add(id, at, () => { seen.push(id); return Promise.resolve(); }));
    await prepareSpawnView(undefined, undefined, 'player');
    expect(await Promise.all(pending)).toEqual([true, true, true]);
    expect(new Set(seen)).toEqual(new Set(['spawn', 'origin', 'high']));
  } finally { owner.dispose(); }
});

test('a packs scene driver retains distant tiles until its owner retires', async () => {
  expect(runtimePacksOn()).toBe(true);
  expect(folderTileRing({})()).toBe(CELL_RING);
  const owner = new Scope('packs.driver'), live = new Set<number>();
  const driver = new TileDriver(owner, [{ id: 'distant', tiles: () => new Set([0, 63]), attach: (tile, scope) => {
    live.add(tile); scope.onDispose(() => { live.delete(tile); }); return Promise.resolve();
  } }], folderTileRing({}), () => Promise.resolve());
  try {
    await driver.require(new Set([0, 63]));
    expect(live).toEqual(new Set([0, 63]));
    driver.step(-220, -220);
    expect(live).toEqual(new Set([0, 63]));
    driver.step(220, 220);
    expect(live).toEqual(new Set([0, 63]));
  } finally { owner.dispose(); }
  expect(live.size).toBe(0);
});
