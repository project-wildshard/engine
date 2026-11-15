import { expect, test } from 'vitest';
import * as THREE from 'three';
import { pickTarget } from '../src/client/engine/explore/pick';
import { MERGED_VIEW, SHADOW_LAYER } from '../src/client/engine/core/shadowLayer';
import { mergeView } from '../src/client/game/shardfile/groundMerge';
import { Scope } from '../src/shared/engine/app/scope';

// Meta SHARD-SOURCE ss4d (the stage-4 review): AP8 merges a static prop into one view mesh per material and moves the
// prop's own mesh to SHADOW_LAYER; the World Explorer's tap raycaster (view layer) skipped it, so a merged prop could
// not be picked. A merged member is a drawn surface; a shadow-only depth proxy still is not.

const ray = (): THREE.Raycaster => new THREE.Raycaster(new THREE.Vector3(0, 0.5, 5), new THREE.Vector3(0, 0, -1), 0, 50);

test('a merged prop is picked through its own mesh on the shadow layer', () => {
  const world = new THREE.Group(), tile = new THREE.Group(), material = new THREE.MeshStandardMaterial();
  const prop = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material); prop.position.y = 0.5;
  tile.add(prop); world.add(tile); world.updateMatrixWorld(true);
  const scope = new Scope('pick.test');
  mergeView(world, prop, material, scope);
  expect(prop.layers.isEnabled(0)).toBe(false);
  expect(prop.userData[MERGED_VIEW]).toBe(true);
  const caster = ray(), before = caster.layers.mask;
  const hit = pickTarget(caster, [{ object: tile, entry: 'scene.hut' }]);
  expect(hit?.target.entry).toBe('scene.hut');
  expect(hit?.point.z).toBeCloseTo(0.5);
  expect(caster.layers.mask).toBe(before);
  scope.dispose();
});

test('a shadow-only depth proxy is still not pickable', () => {
  const tile = new THREE.Group(), proxy = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  proxy.position.y = 0.5; proxy.layers.set(SHADOW_LAYER); tile.add(proxy); tile.updateMatrixWorld(true);
  expect(pickTarget(ray(), [{ object: tile, entry: 'cabin' }])).toBeNull();
});
