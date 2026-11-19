// @vitest-environment node
// ONE-FORMAT OF27b5: a skin whose material reads vertex colours (a painterly family default) over a GLB with no COLOR_0
// gets a white colour channel when it loads. Added later, at draw time, three has already cached the mesh's buffers
// without it and the skin draws black from its first frame on (the OF27b4 board's wolf).
import { expect, test } from 'vitest';
import * as THREE from 'three';
import { colourForVertexMaterial } from './clientSkins';

const body = (): THREE.BufferGeometry => new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));

test('a vertex-coloured skin material gives a colourless skin a white colour channel at load', () => {
  const geometry = body();
  colourForVertexMaterial(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
  const colour = geometry.getAttribute('color');
  expect(colour.count).toBe(3);
  expect([colour.getX(2), colour.getY(2), colour.getZ(2)]).toEqual([1, 1, 1]);
});

test('a skin that carries its colours, or a material that ignores them, is left alone', () => {
  const coloured = body(), own = new THREE.BufferAttribute(new Float32Array(9).fill(0.5), 3);
  coloured.setAttribute('color', own);
  colourForVertexMaterial(coloured, new THREE.MeshLambertMaterial({ vertexColors: true }));
  expect(coloured.getAttribute('color')).toBe(own);
  const plain = body();
  colourForVertexMaterial(plain, new THREE.MeshStandardMaterial());
  expect(plain.hasAttribute('color')).toBe(false);
});
