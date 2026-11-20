import { afterEach, expect, test } from 'vitest';
import * as THREE from 'three';
import { chunkShadowCastersSliced, resetViewPieces, VIEW_CELLS, VIEW_WHOLE_SHARE } from '../src/client/engine/world/shadowChunks';
import { duringShadowPass } from '../src/client/engine/world/cascadeCull';

// meta DRIFTWOOD-FPS DF9 (mini-driftwood13c): with `debug.viewPieces` an island-wide opaque mesh draws in the view by at
// most VIEW_CELLS frustum-culled pieces of its own triangles; the mesh itself stays for the shadow passes only.

afterEach(() => { resetViewPieces(); });

/** a box round the sheet's -x, -z corner only: a quarter of it in view */
const corner = (): THREE.Frustum => new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().makeOrthographic(-125, -55, 95, 40, -500, 500).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
const everywhere = (): THREE.Frustum => new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().makeOrthographic(-500, 500, 500, -500, -500, 500));
function sheet(name: string, material: THREE.Material = new THREE.MeshStandardMaterial()): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(240, 180, 48, 36); geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
  return mesh;
}
const viewPieces = (mesh: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  mesh.traverse(o => { if (o instanceof THREE.Mesh && o.name.includes('-view-pieces-')) out.push(o); });
  return out;
};

test('slot on: an opaque island-wide mesh draws in the view by its pieces, every triangle once', async () => {
  resetViewPieces(true);
  const scene = new THREE.Scene(), ground = sheet('ground');
  scene.add(ground);
  await chunkShadowCastersSliced(scene, () => null);
  const pieces = viewPieces(ground);
  expect(pieces.length).toBeGreaterThan(1);
  expect(pieces.length).toBeLessThanOrEqual(VIEW_CELLS);
  const triangles = (ground.geometry.index?.count ?? 0);
  expect(pieces.reduce((n, p) => n + p.geometry.drawRange.count, 0)).toBe(triangles);
  for (const piece of pieces) {
    expect(piece.material).toBe(ground.material);
    expect(piece.layers.isEnabled(0)).toBe(true);
    expect(piece.castShadow).toBe(false);
    expect(piece.geometry.getAttribute('position')).toBe(ground.geometry.getAttribute('position'));
  }
  // a view that sees it all draws it whole, in one draw, and none of its pieces
  expect(VIEW_WHOLE_SHARE).toBeLessThan(1);
  expect(ground.intersectsFrustum(everywhere())).toBe(true);
  expect(pieces.filter(p => p.intersectsFrustum(everywhere()))).toHaveLength(0);
  // a view of one corner draws the pieces there, not the mesh
  expect(ground.intersectsFrustum(corner())).toBe(false);
  const seen = pieces.filter(p => p.intersectsFrustum(corner())).length;
  expect(seen).toBeGreaterThan(0);
  expect(seen).toBeLessThan(pieces.length);
  // a shadow pass still sees the mesh by its own test (it casts nothing here)
  let inPass = false; duringShadowPass(() => { inPass = ground.intersectsFrustum(corner()); });
  expect(inPass).toBe(true);
  // a second walk adds none
  await chunkShadowCastersSliced(scene, () => null);
  expect(viewPieces(ground)).toHaveLength(pieces.length);
});

test('slot on: a caster keeps its shadow pieces and its last-cascade draw; a transparent mesh stays whole', async () => {
  resetViewPieces(true);
  const scene = new THREE.Scene(), caster = sheet('caster'), water = sheet('water', new THREE.MeshStandardMaterial({ transparent: true }));
  caster.castShadow = true;
  scene.add(caster, water);
  const report = await chunkShadowCastersSliced(scene, () => null);
  expect(report.meshes).toBe(1);
  expect(viewPieces(caster).length).toBeGreaterThan(1);
  let shadowPieces = 0; caster.traverse(o => { if (o.name.includes('-shadow-pieces-')) shadowPieces++; });
  expect(shadowPieces).toBe(report.pieces);
  expect(caster.intersectsFrustum(corner())).toBe(false);
  let inPass = true; duringShadowPass(() => { inPass = caster.intersectsFrustum(everywhere()); });
  expect(inPass).toBe(false); // not a last cascade: its shadow pieces cast
  expect(viewPieces(water)).toHaveLength(0);
  expect(water.intersectsFrustum(everywhere())).toBe(true);
});

test('slot off (the default): nothing changes in the view', async () => {
  resetViewPieces(false);
  const scene = new THREE.Scene(), ground = sheet('ground');
  scene.add(ground);
  await chunkShadowCastersSliced(scene, () => null);
  expect(viewPieces(ground)).toHaveLength(0);
  expect(ground.intersectsFrustum(everywhere())).toBe(true);
});
