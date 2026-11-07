// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { parse } from 'valibot';
import { BoxGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { installScopeEnvironment, scopeEnvironment } from '../src/shared/engine/app/scopeEnvironment';
import { FakeGame, legacyDouble } from '../src/test/engine/FakeGame';
import { defineModel } from '../src/client/engine/models/model';
import { WorldRegistry } from '../src/client/engine/world/registry';
import { SkyRig } from '../src/client/engine/world/skyRig';
import { WorldScenePlacementSchema } from '@wildshard/format/worldScenePlacement';
import type { ShardContext } from '../src/client/game/plugin/context';
import { SceneHandles } from '../src/client/game/shardfile/sceneHandles';
import { WorldEntry } from '../src/client/game/shardfile/worldEntry';
import { WorldScenePlacement } from '../src/client/game/shardfile/worldScenePlacement';

const originalEnvironment = scopeEnvironment();
afterEach(() => { installScopeEnvironment(originalEnvironment); });

function fixture(moving = true, copies = 1) {
  const scope = new Scope('moving-copy'), fake = new FakeGame(), game = fake.asGame(), registry = new WorldRegistry();
  registry.scope = scope;
  const sky: unknown = Object.create(SkyRig.prototype);
  if (!(sky instanceof SkyRig)) throw new Error('Missing native sky prototype');
  type World = NonNullable<NonNullable<ShardContext['game']['runtime']>['world']>;
  const world = legacyDouble<World>({ sky, game, registry, forest: legacyDouble<World['forest']>({}) });
  Object.assign(game, { runtime: { world } });
  const ctx = legacyDouble<ShardContext>({ scope, game: legacyDouble<ShardContext['game']>({
    runtime: legacyDouble<NonNullable<ShardContext['game']['runtime']>>({ world }),
  }) });
  const geometry = new BoxGeometry(2, 1, 6), material = new MeshStandardMaterial();
  const model = defineModel<Record<string, unknown>>({ id: 'fixture-ferry/model', name: 'Ferry', category: 'props', pipeline: 'code',
    file: 'fixture-ferry.ts', defaults: {}, build: () => new Group().add(new Mesh(geometry, material)),
    colliders: () => [{ kind: 'box', x: 0, y: 0, z: 0, hx: 1, hy: 0.5, hz: 3 }] });
  const row = parse(WorldScenePlacementSchema, { id: 'ferry', model: 'ferry',
    draw: 'single', poses: Array.from({ length: copies }, (_, i) => ({ x: 37 + i, y: 2, z: -83,
      matrix: new Matrix4().makeTranslation(37 + i, 2, -83).elements })),
    piece: { id: 'ferry-piece', ...(moving ? { follows: 'copy' } : {}) } });
  const handles = new SceneHandles(), placement = new WorldScenePlacement(ctx, row, { model: () => model }, scope, new Map(), []);
  handles.publish('ferry', placement);
  return { scope, registry, geometry, material, handles, placement, close: () => { scope.dispose(); fake.playerScope.dispose(); geometry.dispose(); material.dispose(); } };
}

test('a moving copy keeps its original object and local collider frame through absolute mover poses', async () => {
  const f = fixture();
  try {
    await WorldEntry.admit({ blocks: { dock: [{ kind: 'place', id: 'ferry' }] } }, {
      root: new Group(), scope: f.scope, scenes: f.handles, tier: 'phone',
    }).run('dock');
    // Exercise the original entry + tile driver path as well: before the fix
    // it creates a container and nests the already placed copy below it.
    for (const content of f.handles.tiled()) for (const tile of content.tiles()) await content.attach(tile, f.scope.child('tile'));
    const root = f.handles.object('ferry.root');
    const mesh = root.getObjectByProperty('isMesh', true);
    if (!(mesh instanceof Mesh)) throw new Error('Missing actual rendered copy');
    for (const [position, rotation] of [
      [[37, 2, -83], [0, 0, 0]],
      [[38, 2.5, -85], [0.08, 0.2, -0.03]],
      [[36, 1.5, -82], [-0.1, -0.3, 0.02]],
    ] as const) {
      root.position.set(position[0], position[1], position[2]);
      root.rotation.set(rotation[0], rotation[1], rotation[2]); root.updateWorldMatrix(true, true);
      expect(mesh.getWorldPosition(new Vector3()).toArray()).toEqual(position);
      expect(f.handles.object('ferry.root')).toBe(root);
    }
    expect(f.handles.requiresWhole('ferry')).toBe(true);
    expect(f.handles.tiled()).toHaveLength(0);
    expect(f.registry.pieces).toHaveLength(1);
    expect(f.registry.pieces[0]?.follows).toBe(root);
    expect(f.registry.pieces[0]?.colliders).toEqual([{ kind: 'box', x: 0, y: 0, z: 0, hx: 1, hy: 0.5, hz: 3 }]);
    expect(await f.handles.place('ferry')).toBe(await f.placement.load());
  } finally { f.close(); }
});

test('the original one-copy mover contract refuses multiple copies without publishing a root', async () => {
  const f = fixture(true, 2);
  try {
    expect(f.handles.requiresWhole('ferry')).toBe(true);
    await expect(f.handles.place('ferry')).rejects.toThrow("one 'single' placement only");
    expect(f.handles.has('ferry.root')).toBe(false);
    expect(f.registry.pieces).toHaveLength(0);
  } finally { f.close(); }
});

test('direct tiling refuses a moving copy before publishing a replacement root', () => {
  const f = fixture();
  try {
    expect(() => f.handles.tile('ferry')).toThrow('requires its original copy');
    expect(f.handles.has('ferry.root')).toBe(false);
    expect(f.handles.tiled()).toHaveLength(0);
    expect(f.registry.pieces).toHaveLength(0);
  } finally { f.close(); }
});

test('ordinary fixed copies retain their tile container and tile-owned lifetime', async () => {
  const f = fixture(false);
  try {
    expect(f.handles.requiresWhole('ferry')).toBe(false);
    const content = f.handles.tile('ferry'), root = f.handles.object('ferry.root'), tile = [...content.tiles()][0];
    if (tile === undefined) throw new Error('Missing authored tile');
    const owner = f.scope.child('visible-tile');
    await content.attach(tile, owner);
    expect(root.position.toArray()).toEqual([0, 0, 0]);
    expect(root.children).toHaveLength(1);
    expect(root.children[0]?.getWorldPosition(new Vector3()).toArray()).toEqual([37, 2, -83]);
    owner.dispose();
    expect(root.children).toHaveLength(0);
  } finally { f.close(); }
});
