// SB43 (STAGING-BUGBASH): every uploaded zone (Mossgate Hollow, Mirror Salt, Glowfen) holds only the declared iron sword
// (`kit.sword`, view position [0.2, -0.35, -0.6], rotation 0), and on a phone it stood as a tall flat-grey slab over the right
// third of the view: the recipe built the sword upright and painted every part one flat colour.
import { expect, test } from 'vitest';
import { Box3, Mesh, MeshStandardMaterial, PerspectiveCamera, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';
import { CAMERA_FOV } from '@wildshard/engine/core/config';
import { itemMesh } from './weaponFamily';
import type { ItemFamilyPorts } from '@wildshard/engine/combat/itemFamilies';

const VIEW = { recipe: 'kit.sword', colour: '#888888', position: [0.2, -0.35, -0.6], rotation: [0, 0, 0] } as const;
const ports = { view: VIEW, scope: { onDispose: () => undefined } } as unknown as Pick<ItemFamilyPorts, 'view' | 'model' | 'scope'>;

/** The model's meshes, typed. */
function meshes(root: Object3D): Mesh<BufferGeometry, Material>[] {
  const out: Mesh<BufferGeometry, Material>[] = [];
  root.traverse(node => { if (node instanceof Mesh) out.push(node as Mesh<BufferGeometry, Material>); });
  return out;
}

/** The sword's screen box (NDC, -1..1) in the 402x874 phone portrait the zone sweep shoots, at the declared pose. */
function screenBox(): { minX: number; maxX: number; minY: number; maxY: number } {
  const camera = new PerspectiveCamera(CAMERA_FOV, 402 / 874, 0.08, 100);
  const model = itemMesh(ports); camera.add(model); camera.updateMatrixWorld(true);
  const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }, p = new Vector3();
  for (const node of meshes(model)) {
    const position = node.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld).project(camera);
      box.minX = Math.min(box.minX, p.x); box.maxX = Math.max(box.maxX, p.x); box.minY = Math.min(box.minY, p.y); box.maxY = Math.max(box.maxY, p.y);
    }
  }
  return box;
}

test('the declared sword keeps its own paint (blade, guard, grip and fists), not one flat colour', () => {
  const found = meshes(itemMesh(ports));
  expect(found.length).toBeGreaterThan(0);
  for (const mesh of found) {
    expect(mesh.material).toBeInstanceOf(MeshStandardMaterial);
    expect((mesh.material as MeshStandardMaterial).vertexColors).toBe(true);
    expect(mesh.geometry.getAttribute('color')).toBeDefined();
  }
});

test('at its declared rest the sword tips forward low-right, not a slab standing over the right third of a phone view', () => {
  const box = screenBox();
  // the old upright build's tip stood 0.62 of the half-height above the crosshair and it filled 81% of the frame's height;
  // at REST the hands sit at the lower-right edge and the tip rests at the crosshair (0.01)
  expect(box.maxY).toBeLessThan(0.2);
  expect((Math.min(box.maxY, 1) - Math.max(box.minY, -1)) / 2).toBeLessThan(0.6);
  // its local frame: the blade's tip leans away from the eye (the starter sword's REST), so the model is deeper than tall
  const size = new Box3().setFromObject(itemMesh(ports)).getSize(new Vector3());
  expect(size.z).toBeGreaterThan(size.y * 0.8);
});
