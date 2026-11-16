// NINE-DRAGON-BENCHMAX NB8: the board under you was 11 draws (12 with its depth clear) on the phone's walk. Parts sharing a
// material are one mesh, the additive halos one pass: 5 meshes, every triangle kept, the animated materials still returned.
import * as THREE from 'three';
import { expect, test } from 'vitest';
import { buildHoverboard } from './hoverboardGeometry';

const triangles = (g: THREE.BufferGeometry): number => (g.index?.count ?? g.getAttribute('position').count) / 3;

test('one mesh per material, both halo faces in one pass, no triangle lost', () => {
  const g = new THREE.Group();
  const { pulse, glow } = buildHoverboard(g);
  const meshes = g.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh);
  expect(meshes).toHaveLength(5);
  expect(new Set(meshes.map(m => m.material)).size).toBe(5);
  expect(meshes.filter(m => m.material === pulse)).toHaveLength(1);
  expect(glow.forceSinglePass && glow.side === THREE.DoubleSide && glow.blending === THREE.AdditiveBlending && !glow.depthWrite).toBe(true);
  // deck 524 + grip 140, strip 352 + lamp 12 + inlay 12, discs 2 × 96, halos 2 × 24
  expect(meshes.map(m => triangles(m.geometry))).toEqual([524, 140, 376, 192, 48]);
  // every part stays where it was: the discs and halos at both ends, under the deck
  const halos = meshes[4]; if (halos === undefined) throw new Error('no halos');
  const box = new THREE.Box3().setFromObject(halos);
  expect(box.min.z).toBeCloseTo(-0.9 * 0.3 - 0.15, 5); expect(box.max.z).toBeCloseTo(0.9 * 0.3 + 0.15, 5);
  expect(box.max.y).toBeCloseTo(-0.032 / 2 - 0.045, 5);
});
