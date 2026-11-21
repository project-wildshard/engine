import * as THREE from 'three';
import { expect, test } from 'vitest';
import { FarBatches } from './farBatch';
import { buildKitBatches, primeBatchPrograms, sceneBatches } from './kitBatch';
import { installFarProxy } from './farView';
import type { FarLookRuntime } from '../../../shared/game/grid/farProxy';

// meta DRIFTWOOD-FPS DF10 (mini-dfload): the batches' programs link under the loading card. On the iPhone 13 the far batch
// and the kit's three materials linked inside draws after control (1.1 to 1.4 s frames): a batch hangs on the page scene,
// outside every entered root whose warm-up links the road variants.
const look: FarLookRuntime = { family: 'toon', haze: { colour: [0.5, 0.6, 0.7] } };
function proxyGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(10, 10, 2, 2);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3).fill(1), 3));
  return geometry;
}
function box(): THREE.BufferGeometry { const geometry = new THREE.BoxGeometry(1, 1, 1); geometry.deleteAttribute('uv'); geometry.clearGroups(); return geometry; }

test('the loading step links every kit and far batch, and nothing else', async () => {
  const scene = new THREE.Scene(), material = new THREE.MeshLambertMaterial();
  const cell = new THREE.Group(); scene.add(cell);
  cell.add(new THREE.Mesh(box(), material), new THREE.Mesh(box(), material));
  const kit = buildKitBatches(scene);
  const far = new FarBatches(scene), root = new THREE.Group(); scene.add(root);
  const view = installFarProxy(root, proxyGeometry(), look);
  if (view === undefined) throw new Error('a proxy');
  // the ring's preparation warms a stand-in first (never in the scene), then the proxy joins its batch
  const stand = far.stand(view, look, false);
  expect(stand).not.toBe(null);
  expect(stand?.parent).toBe(null);
  stand?.retire();
  expect(far.adopt(view, look, false)).toBe(true);
  const warmed: THREE.Object3D[][] = [];
  const count = await primeBatchPrograms(scene, async (roots) => { warmed.push([...roots]); await Promise.resolve(); });
  expect(count).toBe(2);
  expect(warmed.length).toBe(1); // one warm-up, unpaced, under the card
  expect(new Set(warmed[0])).toEqual(new Set([...kit, ...far.batches()]));
  expect(sceneBatches(scene).every(batch => batch.parent === scene)).toBe(true);
  far.dispose();
});

test('a page with no batches warms nothing', async () => {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(box(), new THREE.MeshLambertMaterial()));
  let calls = 0;
  expect(await primeBatchPrograms(scene, async () => { calls++; await Promise.resolve(); })).toBe(0);
  expect(calls).toBe(0);
});

test('a far group keeps one material by default, so a ring change never frees and relinks its program', () => {
  const scene = new THREE.Scene(), far = new FarBatches(scene);
  const [a, b] = [0, 1].map(i => { const root = new THREE.Group(); root.position.set(i * 100, 0, 0); scene.add(root); return installFarProxy(root, proxyGeometry(), look); });
  if (a === undefined || b === undefined) throw new Error('two proxies');
  far.adopt(a, look, false);
  const first = far.batches()[0]?.material;
  far.adopt(b, look, false);
  expect(far.batches()[0]?.material).toBe(first);
  far.dispose();
});
