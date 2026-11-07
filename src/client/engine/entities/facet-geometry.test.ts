import { expect, test } from 'vitest';
import * as THREE from 'three';
import { facetGeometry } from './lowpoly';

/** the previous facetGeometry, through three's accessors and bounds (the reference) */
function reference(geo: THREE.BufferGeometry, jitter: number): THREE.BufferGeometry {
  const g = geo.toNonIndexed();
  g.computeVertexNormals();
  const col = g.getAttribute('color'), pos = g.getAttribute('position');
  const skip = (v: number): boolean => g.groups.some((gr) => (gr.materialIndex ?? 0) === 2 && v >= gr.start && v < gr.start + gr.count);
  for (let v = 0; v < pos.count; v += 3) {
    if (skip(v)) continue;
    const cx = pos.getX(v) + pos.getX(v + 1) + pos.getX(v + 2), cy = pos.getY(v) + pos.getY(v + 1) + pos.getY(v + 2), cz = pos.getZ(v) + pos.getZ(v + 1) + pos.getZ(v + 2);
    const h = Math.sin(cx * 127.1 + cy * 311.7 + cz * 74.7) * 43758.5453, m = 1 + (h - Math.floor(h) - 0.5) * 2 * jitter;
    for (let k = 0; k < 3; k++) col.setXYZ(v + k, col.getX(v + k) * m, col.getY(v + k) * m, col.getZ(v + k) * m);
  }
  g.computeBoundingSphere();
  if (g.boundingSphere !== null) g.boundingSphere.radius += 0.6;
  g.computeBoundingBox();
  return g;
}

function body(colour: (n: number) => THREE.BufferAttribute): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.7, 7, 5).toNonIndexed().toNonIndexed();
  const indexed = new THREE.IcosahedronGeometry(0.5, 1);
  indexed.translate(0.3, -0.2, 1.1);
  const merged = new THREE.BufferGeometry();
  const positions = [...g.getAttribute('position').array, ...indexed.toNonIndexed().getAttribute('position').array];
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const n = positions.length / 3;
  merged.setAttribute('color', colour(n));
  merged.setIndex(Array.from({ length: n }, (_, i) => i));
  merged.addGroup(0, n - 60, 0); merged.addGroup(n - 60, 60, 2);
  return merged;
}

test('T10: facetGeometry keeps every value of the accessor version: positions, normals, colours and bounds', () => {
  const colours = [
    (n: number) => new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => 0.2 + (i % 7) / 10), 3),
    (n: number) => new THREE.BufferAttribute(new Uint8Array(Array.from({ length: n * 3 }, (_, i) => (i * 37) % 256)), 3, true),
  ];
  for (const colour of colours) {
    const want = reference(body(colour), 0.12), got = facetGeometry(body(colour), 0.12);
    for (const name of ['position', 'normal', 'color']) expect([...got.getAttribute(name).array]).toEqual([...want.getAttribute(name).array]);
    expect(got.groups).toEqual(want.groups);
    expect(got.boundingBox).toEqual(want.boundingBox);
    expect(got.boundingSphere).toEqual(want.boundingSphere);
  }
});
