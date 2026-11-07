// @vitest-environment happy-dom
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { legacyDouble } from '../src/test/engine/FakeGame';
import { emptyShardfile } from '../src/shared/host/author';
import { parseClientPlan, type ClientFeatureRow } from '@wildshard/format/clientPlan';
import type { ShardContext } from '../src/client/game/plugin/context';
import { CLIENT_FEATURES } from '../src/client/game/shardfile/clientPlan';
import { clientSceneHandles } from '../src/client/game/shardfile/clientSceneHandles';
import { SceneHandles } from '../src/client/game/shardfile/sceneHandles';
import { createShardProduct } from '../src/shared/game/shardfile/shardProduct';
import { tiledMesh } from '../src/client/game/shardfile/tiledMesh';
import * as sceneInstaller from '../src/client/game/shardfile/worldScenes';
import { jsonSlot } from '../src/client/engine/saves/slots';
import { LEVEL_DOWNLOAD_SLOT, runtimePacksOn } from '../src/client/engine/boot/loadingPacks';

// This ruler tests device-ring retirement on the loose-file harness path.
// Packs deliberately keep the whole cell resident after player movement.
const download = jsonSlot(LEVEL_DOWNLOAD_SLOT, 'device'), previous = download.read();
beforeAll(() => { download.write('shardfile'); expect(runtimePacksOn()).toBe(false); });
afterAll(() => { download.write(previous); });

function fixture(slug: string, host?: 'world.assembly' | 'world.forest-page') {
  const scope = new Scope(`hostless:${slug}`), handles = new SceneHandles();
  const source = emptyShardfile({ slug, name: 'Hostless scenes', author: 'Fixture', revision: 1, seed: 7 });
  source.spawn.x = 0; source.spawn.z = 0;
  const features: ClientFeatureRow[] = [{ kind: 'world.scenes' }];
  if (host === 'world.assembly') features.push({ kind: host, library: 'fixture', catalogue: 'models.json', rows: { stages: [{ kind: 'fixed-draws', id: 'fixture.draws' }] } });
  if (host === 'world.forest-page') features.push({ kind: host, file: 'forest.json' });
  const plan = parseClientPlan({ version: 1, features });
  const sections = new Map<string, unknown>([['client/plan', plan], ['world/scenes', { version: 1, libraries: [], materials: [], steps: [] }]]);
  const product = createShardProduct({ slug, revision: 1, shardfile: source, sections, files: new Map(),
    read: () => Promise.reject(new Error('This driver fixture has no external payloads')) });
  const geometry = new BufferGeometry();
  // Two triangles straddle x=0, just as Far Reach's mill spans a tile edge.
  geometry.setAttribute('position', new Float32BufferAttribute([-2, 0, 10, -1, 0, 10, -1, 1, 10,
    1, 0, 10, 2, 0, 10, 1, 1, 10], 3));
  const material = new MeshBasicMaterial(), merged = new Mesh(geometry, material);
  const groups = ['trees', 'sky-isles'].map(name => {
    const mesh = new InstancedMesh(geometry, material, 2); mesh.name = `${slug}.${name}`;
    mesh.setMatrixAt(0, new Matrix4().makeTranslation(-10, 0, 10));
    mesh.setMatrixAt(1, new Matrix4().makeTranslation(10, 0, 10));
    return mesh;
  });
  for (const mesh of [...groups, merged]) {
    const content = tiledMesh(mesh.name || `${slug}.mill`, mesh, new Matrix4());
    if (content === null) throw new Error('The regression needs actual multi-tile content');
    handles.addTiled(content);
  }
  const player = { position: new Vector3() }, system = vi.fn<ShardContext['system']>();
  type World = NonNullable<NonNullable<ShardContext['game']['runtime']>['world']>;
  const ctx = legacyDouble<ShardContext>({ scope, product, system, root: new Group(),
    game: legacyDouble<ShardContext['game']>({ runtime: legacyDouble<NonNullable<ShardContext['game']['runtime']>>({
      // MF13: the tile follower reads the world camera's view (cf7426e56d)
      world: legacyDouble<World>({ player: legacyDouble<World['player']>({ position: player.position }), game: legacyDouble<World['game']>({ camera: new PerspectiveCamera() }) }),
    }) }),
  });
  const install = vi.spyOn(sceneInstaller, 'installWorldScenes').mockResolvedValue(handles);
  return { scope, handles, product, ctx, groups, merged, system, player, install,
    close: () => { scope.dispose(); install.mockRestore(); for (const mesh of groups) mesh.dispose(); geometry.dispose(); material.dispose(); } };
}

test.each(['far-reach', 'driftwood-isle', 'sunscar-dunes'])(
  'a hostless %s scenes plan attaches its instances and merged parts before returning', async slug => {
    const f = fixture(slug);
    try {
      expect(f.groups.map(mesh => mesh.count)).toEqual([0, 0]);
      expect(f.merged.geometry.drawRange.count).toBe(0);
      await CLIENT_FEATURES['world.scenes'].install(f.ctx, { kind: 'world.scenes' }, f.scope);
      const installed = f.install.mock.calls[0];
      expect(installed?.[0]).toBe(f.ctx);
      expect(installed?.[1]).toBe(f.product.section('world/scenes'));
      expect(installed?.[2]).toBe(f.scope);
      expect(clientSceneHandles(f.product, f.scope)).toBe(f.handles);
      for (const mesh of f.groups) expect(mesh.count, mesh.name).toBe(2);
      expect(f.merged.geometry.drawRange).toEqual({ start: 0, count: 6 });
      expect(f.system).toHaveBeenCalledOnce();
      const step = f.system.mock.calls[0]?.[0];
      if (step === undefined) throw new Error('Missing hostless scene follower');
      expect(step).toMatchObject({ id: 'client.world.scene-tiles', phase: 'update' });
      f.player.position.set(-220, 0, -220); step.run(0, 0);
      await vi.waitFor(() => { expect(f.groups.map(mesh => mesh.count)).toEqual([0, 0]); });
      expect(f.merged.geometry.drawRange.count).toBe(0);
    } finally { f.close(); }
  },
);

test.each(['world.assembly', 'world.forest-page'] as const)(
  '%s remains the only driver when a scenes plan already has a host', async host => {
    const f = fixture('fixture-hosted', host);
    try {
      await CLIENT_FEATURES['world.scenes'].install(f.ctx, { kind: 'world.scenes' }, f.scope);
      expect(clientSceneHandles(f.product, f.scope)).toBe(f.handles);
      expect(f.groups.map(mesh => mesh.count)).toEqual([0, 0]);
      expect(f.merged.geometry.drawRange.count).toBe(0);
      expect(f.system).not.toHaveBeenCalled();
    } finally { f.close(); }
  },
);
