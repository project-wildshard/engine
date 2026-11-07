import { expect, test } from 'vitest';
import { BoxGeometry, BufferGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from 'three';
import { paintedGroundMerge } from './paintedGroundMerge';
import { GroundMerge } from '../shardfile/groundMerge';
import { Scope } from '@wildshard/engine/app/scope';
import { realGc } from '@wildshard/engine/test/realGc';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';

function installed() {
  const parent = new Group(), original = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  parent.position.set(10, 0, 20); parent.add(original);
  original.castShadow = true; original.receiveShadow = false; original.renderOrder = 17;
  const terrain = { mesh: original }, positions: number[][] = [], follower = { at: (x: number, z: number) => { positions.push([x, z]); } };
  const replace = paintedGroundMerge(terrain, parent, original, follower), scope = new Scope('ground tiles');
  const merge = new GroundMerge(parent, original.material, 'ground', replace);
  merge.add(new Mesh(new BoxGeometry(), original.material), scope);merge.rebuild();
  original.removeFromParent();original.geometry.dispose();
  return { parent, terrain, positions, follower, replace, merge, scope, original: new WeakRef(original), geometry: new WeakRef(original.geometry), backing: new WeakRef(original.geometry.getAttribute('position').array.buffer) };
}

test('live merged ground releases its removed original mesh and backing', async () => {
  await realGc('src/client/game/looks/painted-ground-lifetime.test.ts', 'live merged ground releases', async collect => {
    const live = installed();
    try {
      await collect(live.original);await collect(live.geometry);await collect(live.backing);
      expect(live.terrain.mesh).toBe(live.merge.mesh);expect(live.parent.children).toEqual([live.terrain.mesh]);
      expect([live.terrain.mesh.castShadow, live.terrain.mesh.receiveShadow, live.terrain.mesh.renderOrder]).toEqual([true, false, 17]);
      // Rebuild and draw after collection: flags, camera transform and the live follower still work.
      live.merge.rebuild();const camera = new PerspectiveCamera(), renderer = legacyDouble<Parameters<Mesh['onBeforeRender']>[0]>({});camera.position.set(15, 2, 27);
      live.terrain.mesh.onBeforeRender(renderer, new Scene(), camera, live.terrain.mesh.geometry, live.terrain.mesh.material, new Group());
      expect(live.positions).toEqual([[5, 7]]);
      live.follower.at = (x, z) => { live.positions.push([z, x]); };
      live.merge.rebuild();camera.position.set(18, 0, 29);
      live.terrain.mesh.onBeforeRender(renderer, new Scene(), camera, live.terrain.mesh.geometry, live.terrain.mesh.material, new Group());
      expect(live.positions).toEqual([[5, 7], [9, 8]]);
      // The callback remains useful without retaining the removed source or requiring its geometry.
      const fresh = new Mesh(new BufferGeometry(), live.terrain.mesh.material);live.replace(fresh);
      expect(live.terrain.mesh).toBe(fresh);expect(fresh.renderOrder).toBe(17);
    } finally { live.scope.dispose(); }
  });
});
