import * as THREE from 'three';
import { expect, test } from 'vitest';
import { CLUSTER_LOD, clusterCount, clusterTile } from '../src/client/engine/world/instanceClusters';

// meta SHARD-SOURCE AP33a/b: a props tile's instanced scatter is cut into clusters with their own bounds, so the frustum
// drops the ones off screen, and a far cluster draws a stable prefix of its copies.
function tile(): { root: THREE.Group; mesh: THREE.InstancedMesh } {
  const root = new THREE.Group(), copies = 8 * 8 * 4;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.8, 0.4), new THREE.MeshStandardMaterial(), copies);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(copies * 3).fill(0.5), 3);
  const m = new THREE.Matrix4();
  // four copies in each of an 8 x 8 grid of 7.8 m squares, over the tile's 62.5 m
  for (let i = 0; i < copies; i++) mesh.setMatrixAt(i, m.makeTranslation((Math.floor(i / 4) % 8) * 7.8 + 1, 0, Math.floor(i / 32) * 7.8 + 1));
  mesh.castShadow = true; root.add(mesh);
  return { root, mesh };
}
function eye(at: THREE.Vector3, look: THREE.Vector3, fov = 60): THREE.Frustum {
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 400); camera.position.copy(at); camera.lookAt(look); camera.updateMatrixWorld();
  return new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
}

test('a tile\'s instanced mesh becomes clusters with their own bounds, and the copies are all kept', () => {
  const { root, mesh } = tile();
  const [replaced] = clusterTile(root);
  expect(replaced?.from).toBe(mesh);
  const clusters = replaced?.to ?? [];
  expect(clusters.length).toBe(16);
  expect(clusters.reduce((sum, cluster) => sum + cluster.count, 0)).toBe(mesh.count);
  expect(root.children).toEqual(clusters);
  for (const cluster of clusters) {
    expect(cluster.boundingSphere?.radius).toBeLessThan(15);
    expect(cluster.castShadow).toBe(true);
    expect(cluster.instanceColor?.getX(0)).toBeCloseTo(0.5);
  }
  root.updateMatrixWorld(true);
  // facing away from the tile, no cluster is in view; looking down one row of it through a narrow lens, some are and some are not
  const away = eye(new THREE.Vector3(-20, 2, -20), new THREE.Vector3(-60, 2, -60));
  expect(clusters.filter((cluster) => away.intersectsObject(cluster)).length).toBe(0);
  const corner = eye(new THREE.Vector3(-5, 1, 7), new THREE.Vector3(60, 1, 7), 20);
  const seen = clusters.filter((cluster) => corner.intersectsObject(cluster)).length;
  expect(seen).toBeGreaterThan(0);
  expect(seen).toBeLessThan(clusters.length);
});

test('a small mesh, a card and a single cell stay whole', () => {
  const small = new THREE.Group(), few = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 8);
  small.add(few);
  expect(clusterTile(small)).toEqual([]);
  const { root, mesh } = tile(); mesh.frustumCulled = false;
  expect(clusterTile(root)).toEqual([]);
  const one = new THREE.Group(), packed = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 32);
  for (let i = 0; i < 32; i++) packed.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i * 0.1, 0, 0));
  one.add(packed);
  expect(clusterTile(one)).toEqual([]);
});

test('a far cluster draws its fraction, a near one all; the phone row is half the desktop\'s', () => {
  const desktop = CLUSTER_LOD.desktop, phone = CLUSTER_LOD.phone;
  expect(clusterCount(40, 10, desktop)).toBe(40);
  expect(clusterCount(40, desktop.far + 1, desktop)).toBe(Math.ceil(40 * desktop.fraction));
  expect(clusterCount(3, 1000, phone)).toBe(1);
  expect(phone.far).toBe(desktop.far / 2);
  expect(phone.fraction).toBe(desktop.fraction / 2);
  // the main view sets the count before the draw; a shadow pass leaves it
  const { root } = tile(), [replaced] = clusterTile(root, () => desktop), cluster = replaced?.to[0];
  if (cluster === undefined) throw new Error('no cluster');
  root.updateMatrixWorld(true);
  const renderer = {} as THREE.WebGLRenderer, scene = new THREE.Scene(), material = new THREE.MeshBasicMaterial(), group = new THREE.Group();
  const far = new THREE.PerspectiveCamera(); far.position.set(500, 0, 500); far.updateMatrixWorld();
  cluster.onBeforeRender(renderer, scene, far, cluster.geometry, material, group);
  expect(cluster.count).toBe(Math.ceil(16 * desktop.fraction));
  const light = new THREE.OrthographicCamera(); light.position.set(0, 0, 0); light.updateMatrixWorld();
  cluster.onBeforeRender(renderer, scene, light, cluster.geometry, material, group);
  expect(cluster.count).toBe(Math.ceil(16 * desktop.fraction));
  const near = new THREE.PerspectiveCamera(); near.position.set(2, 0, 2); near.updateMatrixWorld();
  cluster.onBeforeRender(renderer, scene, near, cluster.geometry, material, group);
  expect(cluster.count).toBe(16);
});
