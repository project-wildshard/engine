import * as THREE from 'three';
import { expect, test } from 'vitest';
import { farBatch } from '@wildshard/engine/core/graphicsMode';
import { FarBatches } from './farBatch';
import { installFarProxy } from './farView';
import type { FarLookRuntime } from '../../../shared/game/grid/farProxy';

// DF10 (mini-df10d): the far ring's proxies draw as one batch per program; each proxy's own mesh stays the source of its
// visibility, flags and band, and leaves the batch when it goes.
const look = (family: FarLookRuntime['family']): FarLookRuntime => ({ family, haze: { colour: [0.5, 0.6, 0.7] } });
function proxyGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(10, 10, 2, 2);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3).fill(1), 3));
  return geometry;
}

test('the phone Low default is on and an explicit boolean wins', () => {
  expect(farBatch(null)).toBe(true);
  expect(farBatch(true)).toBe(true);
  expect(farBatch(false)).toBe(false);
});

test('proxies of one program share a batch that follows each proxy', () => {
  const scene = new THREE.Scene(), batches = new FarBatches(scene);
  const roots = [0, 1, 2].map(i => { const root = new THREE.Group(); root.position.set(i * 100, 0, 0); scene.add(root); return root; });
  const [a, b, c] = roots.map((root, i) => installFarProxy(root, proxyGeometry(), look(i === 2 ? 'pbr' : 'toon')));
  if (a === undefined || b === undefined || c === undefined) throw new Error('three proxies');
  for (const view of [a, b, c]) expect(batches.adopt(view, look(view === c ? 'pbr' : 'toon'), false)).toBe(true);
  const drawn = batches.batches();
  expect(drawn.length).toBe(2); // toon (two cells) and pbr (one)
  expect(a.mesh.layers.mask).toBe(0); // the proxy itself no longer draws
  const toon = drawn.find(batch => batch.instanceCount === 2);
  if (toon === undefined) throw new Error('the toon batch');
  // a proxy's cover (its root hidden) reaches its copy at the next draw's sync; a proxy that goes leaves the batch
  if (roots[1] !== undefined) roots[1].visible = false;
  toon.sync();
  expect([toon.getVisibleAt(0), toon.getVisibleAt(1)]).toEqual([true, false]);
  b.dispose();
  expect(batches.batches().length).toBe(2);
  expect(batches.batches()).toContain(toon);
  expect(toon.instanceCount).toBe(1);
  batches.dispose();
  expect(scene.children.filter(child => child.name === 'far-batch')).toEqual([]);
});

test('a proxy fits in compacted space without replacing live geometry or changing the surviving draw', () => {
  const scene = new THREE.Scene(), batches = new FarBatches(scene);
  const shade = look('toon');
  const a = installFarProxy(scene, new THREE.PlaneGeometry(4, 4, 2, 2), shade);
  const b = installFarProxy(scene, new THREE.PlaneGeometry(6, 6, 2, 2), shade);
  const c = installFarProxy(scene, new THREE.PlaneGeometry(8, 8, 3, 2), shade);
  for (const proxy of [a, b]) batches.adopt(proxy, shade, false);
  const batch = batches.batches()[0];
  if (batch === undefined || batch.geometry.index === null) throw new Error('indexed far batch');
  const positions = batch.geometry.getAttribute('position').array, indices = batch.geometry.index.array;
  a.dispose();
  batches.adopt(c, shade, false);
  expect(batches.batches()[0]).toBe(batch);
  expect(batch.instanceCount).toBe(2);
  expect(batch.geometry.getAttribute('position').array).toBe(positions);
  expect(batch.geometry.index?.array).toBe(indices);
  expect(Array.from(positions.slice(0, 27))).toEqual(Array.from(b.mesh.geometry.getAttribute('position').array));
  expect(Array.from(indices.slice(0, 24))).toEqual(Array.from(b.mesh.geometry.index?.array ?? []));
  batches.dispose();
});

test('DF8 (debug.programReuse): a group keeps one material across rebuilds, so its program is never freed', () => {
  const scene = new THREE.Scene(), batches = new FarBatches(scene, true);
  const roots = [0, 1].map(i => { const root = new THREE.Group(); root.position.set(i * 100, 0, 0); scene.add(root); return root; });
  const [a, b] = roots.map(root => installFarProxy(root, proxyGeometry(), look('toon')));
  if (a === undefined || b === undefined) throw new Error('two proxies');
  expect(batches.adopt(a, look('toon'), false)).toBe(true);
  const first = batches.batches()[0]?.material;
  let disposed = 0;
  if (first instanceof THREE.Material) first.addEventListener('dispose', () => { disposed++; });
  expect(batches.adopt(b, look('toon'), false)).toBe(true); // a rebuild: the old batch retires, its material stays
  expect(batches.batches()[0]?.material).toBe(first);
  expect(batches.batches()[0]?.instanceCount).toBe(2);
  b.dispose(); a.dispose(); // the group empties: its material goes
  expect(disposed).toBe(1);
  batches.dispose();
});

test('DF8 (debug.programFold): a stand-in draws with the group material it will join, and leaves it on retire', () => {
  const scene = new THREE.Scene(), batches = new FarBatches(scene, true);
  const root = new THREE.Group(); scene.add(root);
  const view = installFarProxy(root, proxyGeometry(), look('toon'));
  if (view === undefined) throw new Error('a proxy');
  const stand = batches.stand(view, look('toon'), false);
  if (stand === null) throw new Error('a stand-in');
  const material = stand.material;
  expect(stand.geometry.getAttribute('position').count).toBe(3);
  expect(stand.geometry.index?.count).toBe(3);
  let disposed = 0;
  if (material instanceof THREE.Material) material.addEventListener('dispose', () => { disposed++; });
  expect(stand.parent).toBe(null); // the caller places it, never in the drawn scene
  stand.retire();
  expect(disposed).toBe(0);
  expect(view.mesh.layers.mask).not.toBe(0); // the proxy still draws itself until it joins
  expect(batches.adopt(view, look('toon'), false)).toBe(true);
  expect(batches.batches()[0]?.material).toBe(material); // the warmed program's material
  batches.dispose();
  expect(new FarBatches(scene, false).stand(view, look('toon'), false)).toBe(null); // no kept material: nothing to warm
});
