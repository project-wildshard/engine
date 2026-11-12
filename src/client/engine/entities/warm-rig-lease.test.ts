import { expect, test } from 'vitest';
import { BufferGeometry, CompressedTexture, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Scene, ShaderMaterial, WebGLRenderTarget } from 'three';
import { leaveWithResources } from './AnimalHerdView';

const texture = (): CompressedTexture => new CompressedTexture([{ data: new Uint8Array(16), width: 4, height: 4 }], 4, 4);

// GC16: the parked warm rigs sit on the page scene; a level that leaves frees their coats, and the next cell's entry
// preparation (which walks hidden roots) met the freed texture and held the walk into Sunscar.
test('a parked rig leaves the scene when a texture it draws with is freed', () => {
  const scene = new Scene(), warm = new Group(), coat = texture(), uniform = texture();
  const rig = new Mesh(new BufferGeometry(), [new MeshBasicMaterial({ map: coat }), new ShaderMaterial({ uniforms: { tint: { value: uniform } } })]);
  warm.add(rig); scene.add(warm);
  leaveWithResources(rig);
  coat.dispose();
  expect(rig.parent).toBeNull();
  // a uniform texture counts too
  const other = new Mesh(new BufferGeometry(), new ShaderMaterial({ uniforms: { tint: { value: uniform } } }));
  warm.add(other); leaveWithResources(other); uniform.dispose();
  expect(other.parent).toBeNull();
});

test('a released rig keeps no listener on what it borrowed', () => {
  const coat = texture(), material = new MeshBasicMaterial({ map: coat }), rig = new Mesh(new BufferGeometry(), material), warm = new Group();
  warm.add(rig);
  const release = leaveWithResources(rig);
  release();
  coat.dispose(); material.dispose();
  expect(rig.parent).toBe(warm);
});

test('a page render target (PMREM, a shadow map) never takes a rig out', () => {
  const page = new WebGLRenderTarget(4, 4), coat = texture(), material = new MeshStandardMaterial({ map: coat, envMap: page.texture });
  const warm = new Group(), rig = new Mesh(new BufferGeometry(), material);
  const list = new Mesh(new BufferGeometry(), new ShaderMaterial({ uniforms: { layers: { value: [texture(), coat] } } }));
  warm.add(rig, list); leaveWithResources(rig); leaveWithResources(list);
  page.dispose();
  expect(rig.parent).toBe(warm);
  coat.dispose();
  expect(rig.parent).toBeNull(); expect(list.parent).toBeNull();
});
