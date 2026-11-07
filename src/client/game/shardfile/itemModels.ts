import { type Group, Mesh, SkinnedMesh, BufferGeometry, Material, type Object3D } from 'three';
import { prepareRigLoader } from '@wildshard/engine/anim/rig';
import type { Scope } from '@wildshard/engine/app/scope';
import type { ShardItems } from '@wildshard/format/items';
import { parseGlbData, prepareGlbCost } from '@wildshard/format/glbCost';

interface ModelLease { users: number; ready: Promise<Group> }
const liveModels = new Map<string, ModelLease>();

function isMesh(node: Object3D): node is Mesh {
  if (!(node instanceof Mesh)) return false;
  const geometry: unknown = node.geometry, material: unknown = node.material;
  return geometry instanceof BufferGeometry && (material instanceof Material || Array.isArray(material) && material.every(value => value instanceof Material));
}
function disposeModel(model: Group): void {
  const geometries = new Set<BufferGeometry>(), materials = new Set<Material>();
  model.traverse(node => {
    if (!isMesh(node)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}
async function parseModel(bytes: Uint8Array): Promise<Group> {
  await prepareGlbCost();
  parseGlbData(bytes);
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const doc: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + header.getUint32(12, true))));
  if (doc === null || typeof doc !== 'object') throw new Error('Invalid equipment GLB');
  for (const field of ['images', 'textures', 'skins', 'animations']) {
    const section: unknown = Reflect.get(doc, field);
    if (section !== undefined && (!Array.isArray(section) || section.length > 0)) throw new Error('Equipment model must be static and untextured');
  }
  const file = await (await prepareRigLoader()).createRigLoader().parseBytesAsync(bytes, '');
  const meshes: Mesh[] = [];
  file.scene.traverse(node => { if (isMesh(node)) meshes.push(node); });
  if (meshes.length === 0 || meshes.some(node => node instanceof SkinnedMesh)) { disposeModel(file.scene); throw new Error('Equipment model requires static mesh geometry'); }
  return file.scene;
}

/** Lease static, untextured equipment GLBs by admitted hash. Independent transforms share immutable geometry/materials
 * across live shards; the last scope release disposes them. A late owner reparses after retirement, never a dead model. */
export async function loadItemModels(items: ShardItems, assets: ReadonlyMap<string, Uint8Array>, scope: Scope): Promise<ReadonlyMap<string, Group>> {
  const result = new Map<string, Group>();
  const assertOwner = (): void => { if (scope.disposed) throw new Error('Equipment model owner retired'); };
  const refs = new Set(items.rows.flatMap(row => row.view.asset === undefined ? [] : [row.view.asset]));
  for (const ref of refs) {
    assertOwner();
    const bytes = assets.get(ref);
    if (bytes === undefined) throw new Error(`Missing admitted equipment model ${ref}`);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer));
    const hash = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== ref.replace(/^commons:/u, '')) throw new Error('Equipment model hash mismatch');
    assertOwner();
    let entry = liveModels.get(ref);
    if (entry === undefined) {
      entry = { users: 0, ready: parseModel(bytes) }; liveModels.set(ref, entry);
    }
    const lease = entry; lease.users++;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true; lease.users--;
      if (lease.users !== 0) return;
      if (liveModels.get(ref) === lease) liveModels.delete(ref);
      void lease.ready.then(disposeModel, () => undefined);
    };
    scope.onDispose(release);
    try {
      const model = await lease.ready;
      assertOwner();
      result.set(ref, model);
    } catch (error) { release(); throw error; }
  }
  return result;
}
