// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';
import { BoxGeometry, Group, MeshStandardMaterial } from 'three';
import { defineModel } from '@wildshard/engine/models/model';
import * as place from '@wildshard/engine/models/place';
import type { CullOptions } from '@wildshard/engine/models/cull';
import { Scope } from '@wildshard/engine/app/scope';
import { SkyRig } from '@wildshard/engine/world/skyRig';
import { WorldRegistry } from '@wildshard/engine/world/registry';
import { parseWorldScenePlacement } from '@wildshard/format/worldScenePlacement';
import type { ShardContext } from '../plugin/context';
import { WorldScenePlacement } from './worldScenePlacement';

/** NT6: a copy belongs to every tile its bounds touch, not only its origin's */
test('a 3-tile bridge whose origin is outside the ring draws while any tile it touches is resident', async () => {
  const owner = new Scope('footprint'), registry = new WorldRegistry(), sky: unknown = Object.create(SkyRig.prototype), game = {};
  if (!(sky instanceof SkyRig)) throw new Error('Missing sky');
  const context = { scope: owner, app: { registry }, game } as ShardContext;
  Object.assign(game, { runtime: { world: { sky, game, registry } } });
  const geometry = new BoxGeometry(150, 2, 4).translate(75, 0, 0), material = new MeshStandardMaterial();
  const model = defineModel<Record<string, unknown>>({ id: 'fixture/bridge', name: 'Bridge', category: 'buildings', pipeline: 'code', file: 'fixture.json', defaults: {},
    build: () => [{ geometry, material }], colliders: () => [] });
  // the bridge's origin is its west end, in tile 0 (i 0, j 0); its 150 m span reaches tiles 1 and 2. A second copy far
  // away (tile 63) makes the placement ranged (one draw over several tiles)
  const row = parseWorldScenePlacement({ id: 'bridge', model: 'fixture', draw: 'instanced', cull: {}, poses: [
    { x: -218.75, y: 0, z: -218.75, yxz: { yaw: 0, scale: 1 } }, { x: 218.75, y: 0, z: 218.75, yxz: { yaw: 0, scale: 0.1 } }] });
  const resident: { filter: CullOptions['resident'] } = { filter: undefined };
  const original = place.placeSliced;
  vi.spyOn(place, 'placeSliced').mockImplementation((...args) => { resident.filter ??= args[2].cull?.resident; return original(...args); });
  const handle = new WorldScenePlacement(context, row, { model: () => model, reach: () => Math.hypot(150, 4) }, owner, new Map(), []);
  try {
    // its square footprint: i and j 0 ... 2
    expect([...handle.tiles()].sort((a, b) => a - b)).toEqual([0, 1, 2, 8, 9, 10, 16, 17, 18, 63]);
    const ring = owner.child('ring tile 2');
    expect(await handle.attach(2, ring, new Group())).not.toBeNull();
    const filter = resident.filter; if (filter === undefined) throw new Error('Missing resident filter');
    // only tile 2 is resident: the bridge (origin in tile 0) draws, the far copy does not
    expect(filter.has(0)).toBe(true); expect(filter.has(1)).toBe(false);
    const version = filter.version();
    ring.dispose();
    expect(filter.has(0)).toBe(false); expect(filter.version()).toBeGreaterThan(version);
  } finally { vi.restoreAllMocks(); owner.dispose(); registry.retire(); geometry.dispose(); material.dispose(); }
});

test('a placement whose catalogue states no reach keeps each copy in its origin tile', () => {
  const owner = new Scope('origin'), registry = new WorldRegistry(), context = { scope: owner, app: { registry }, game: {} } as ShardContext;
  const model = defineModel<Record<string, unknown>>({ id: 'fixture/rock', name: 'Rock', category: 'nature', pipeline: 'code', file: 'fixture.json', defaults: {},
    build: () => [], colliders: () => [] });
  const row = parseWorldScenePlacement({ id: 'rocks', model: 'fixture', draw: 'instanced', cull: {}, poses: [
    { x: -218.75, y: 0, z: -218.75, yxz: { yaw: 0, scale: 1 } }, { x: 218.75, y: 0, z: 218.75, yxz: { yaw: 0, scale: 1 } }] });
  try { expect([...new WorldScenePlacement(context, row, { model: () => model }, owner, new Map(), []).tiles()].sort((a, b) => a - b)).toEqual([0, 63]); }
  finally { owner.dispose(); registry.retire(); }
});
