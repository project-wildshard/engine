// FC16: an instanced batch draws its still copies as one mesh, baked at their matrices, and gives a copy that changes back
// to its own geometry's mesh.
import { expect, test } from 'vitest';
import { BoxGeometry, Color, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { InstancedBatch } from './instancedBatch';

const at = (x: number, yaw = 0, scale = 1): Matrix4 => new Matrix4().compose(new Vector3(x, 0, 0), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw), new Vector3(scale, scale, scale));
/** what each mesh under the batch draws: its name's tail and its instance count */
const drawn = (batch: InstancedBatch): string[] => batch.children.flatMap(o => o instanceof InstancedMesh && o.count > 0 ? [`${o.name.split(':').at(-1) ?? ''}x${String(o.count)}`] : []);
const still = (batch: InstancedBatch): InstancedMesh | undefined => batch.children.find((o): o is InstancedMesh => o instanceof InstancedMesh && o.name.endsWith(':still'));

function kit(): { batch: InstancedBatch; ids: number[] } {
  const batch = new InstancedBatch(new MeshStandardMaterial(), { name: 'kit', castShadow: true });
  const a = batch.addGeometry(new BoxGeometry(1, 1, 1)), b = batch.addGeometry(new BoxGeometry(1, 2, 1)), c = batch.addGeometry(new BoxGeometry(2, 1, 1));
  const ids = [batch.addInstance(a), batch.addInstance(b), batch.addInstance(c)];
  ids.forEach((id, i) => { batch.setMatrixAt(id, at(i * 10, i * 0.5, 1 + i)); batch.setColorAt(id, new Color(1, 1, 1)); });
  return { batch, ids };
}

test('still copies draw as one instance; positions and normals as instancing draws them', () => {
  const { batch, ids } = kit();
  expect(drawn(batch)).toEqual(['0x1', '1x1', '2x1']);
  batch.mergeStill();
  expect(drawn(batch)).toEqual(['stillx1']);
  const mesh = still(batch); if (mesh === undefined) throw new Error('no still mesh');
  expect(mesh.castShadow).toBe(true); expect(mesh.instanceColor).not.toBeNull();
  // the third box's first vertex, as three's instancing places it (instanceMatrix * position)
  const box = new BoxGeometry(2, 1, 1), p = new Vector3().fromBufferAttribute(box.getAttribute('position'), 0).applyMatrix4(at(20, 1, 3));
  const merged = mesh.geometry.getAttribute('position'), first = 24 + 24;
  expect([merged.getX(first), merged.getY(first), merged.getZ(first)].map(v => Number(v.toFixed(4)))).toEqual([p.x, p.y, p.z].map(v => Number(v.toFixed(4))));
  // its normal: instancing divides by the squared scale and turns by the 3x3, so the direction is the turned normal
  const n = new Vector3().fromBufferAttribute(mesh.geometry.getAttribute('normal'), first).normalize();
  const turned = new Vector3().fromBufferAttribute(box.getAttribute('normal'), 0).applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1));
  expect(n.distanceTo(turned)).toBeLessThan(1e-6);
  expect(ids.map(id => batch.getVisibleAt(id))).toEqual([true, true, true]);
});

test('a hidden still copy leaves the merge and comes back; a moved or tinted one returns to its own mesh for good', () => {
  const { batch, ids } = kit(); const [a = -1, b = -1, c = -1] = ids;
  batch.mergeStill();
  const vertices = (): number => still(batch)?.geometry.getAttribute('position').count ?? 0;
  expect(vertices()).toBe(72);
  batch.setVisibleAt(b, false); expect(vertices()).toBe(48); expect(batch.getVisibleAt(b)).toBe(false);
  batch.setVisibleAt(b, true); expect(vertices()).toBe(72); expect(drawn(batch)).toEqual(['stillx1']);
  batch.setMatrixAt(a, at(0, 0, 1)); expect(drawn(batch)).toEqual(['stillx1']);       // the same matrix: still
  batch.setMatrixAt(a, at(0.5, 0, 1)); batch.setMatrixAt(a, at(0.75, 0, 1));           // settling twice: still, re-baked
  expect(drawn(batch)).toEqual(['stillx1']); expect(still(batch)?.geometry.getAttribute('position').getX(0)).toBeCloseTo(1.25, 6);
  batch.setMatrixAt(a, at(1, 0, 1)); expect(drawn(batch)).toEqual(['0x1', 'stillx1']); // moved a third time: its own mesh
  batch.setColorAt(c, new Color(1, 0.5, 1)); expect(drawn(batch)).toEqual(['0x1', '2x1', 'stillx1']);
  batch.setMatrixAt(a, at(0, 0, 1)); expect(drawn(batch)).toEqual(['0x1', '2x1', 'stillx1']); // never still again
  batch.setVisibleAt(b, false); expect(drawn(batch)).toEqual(['0x1', '2x1']);
});

test('a copy hidden when the batch merges joins the merge when it is shown', () => {
  const { batch, ids } = kit(); const [, b = -1] = ids;
  batch.setVisibleAt(b, false);
  batch.mergeStill();
  expect(still(batch)?.geometry.getAttribute('position').count).toBe(48);
  batch.setVisibleAt(b, true);
  expect(drawn(batch)).toEqual(['stillx1']); expect(still(batch)?.geometry.getAttribute('position').count).toBe(72);
});

test('copies named in except, and tinted copies, are not still', () => {
  const { batch, ids } = kit(); const [a = -1, b = -1] = ids;
  batch.setColorAt(b, new Color(0.5, 0.5, 0.5));
  batch.mergeStill(new Set([a]));
  expect(drawn(batch)).toEqual(['0x1', '1x1', 'stillx1']);
  batch.dispose(); expect(still(batch)).toBeUndefined();
});
