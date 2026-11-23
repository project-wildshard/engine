import { BufferAttribute, MeshStandardMaterial, Vector3, type BufferGeometry, type Material, type Mesh, type Object3D } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import { graphicsMode } from '@wildshard/engine/core/graphicsMode';
import { TIER } from '@wildshard/engine/core/tier';
import { ownedArray } from '@wildshard/engine/core/ownedBuffer';
import { familyVariant } from '@wildshard/engine/render/families/registry';
import { patchShader, PATCH_ORDER } from '@wildshard/engine/render/shaderPatches';
import { jsonSlot } from '@wildshard/engine/saves/slots';
import { GroundMerge } from './groundMerge';

const slot = jsonSlot('debug.coarsePropMerge', 'device');
export function coarsePropMergeOn(): boolean {
  try { return TIER === 'phone' && graphicsMode() === 'low' && slot.read() === true; } catch { return false; }
}

const TILE_SIZE = 125, SLOTS = 32, TILE_ATTR = 'wsCoarseTile';
type PropMesh = Mesh<BufferGeometry, Material>;
interface Batch {
  owner: Scope;
  merge: GroundMerge;
  corners: Float32Array;
  hidden: Float32Array;
  used: Set<number>;
}
const cellBatches = new WeakMap<Object3D, Map<string, Batch>>();

/** All members use the same material. Only the coarse tile's fragment mask varies by source. */
function group(parent: Object3D, mesh: PropMesh): Batch {
  let batches = cellBatches.get(parent);
  if (batches === undefined) { batches = new Map(); cellBatches.set(parent, batches); }
  const key = `${mesh.material.uuid}|${String(mesh.receiveShadow)}|${String(mesh.renderOrder)}`;
  const found = batches.get(key);
  if (found !== undefined) return found;
  const owner = new Scope('coarse props'), material = familyVariant(mesh.material, owner);
  const corners = ownedArray(Float32Array, SLOTS * 3, { owner: 'game/coarse-props', asset: 'corners', kind: 'geometry-cpu' });
  const hidden = ownedArray(Float32Array, SLOTS * 4, { owner: 'game/coarse-props', asset: 'mask', kind: 'geometry-cpu' });
  const receive = mesh.receiveShadow, order = mesh.renderOrder;
  patchShader(material, 'df10-coarse-props', PATCH_ORDER.decorate + 1, shader => {
    shader.uniforms['wsCoarseCorners'] = { value: corners };
    shader.uniforms['wsCoarseHidden'] = { value: hidden };
    shader.vertexShader = `attribute float ${TILE_ATTR};
uniform vec3 wsCoarseCorners[${String(SLOTS)}];
varying vec2 wsCoarseDelta;
flat varying float wsCoarseID;
${shader.vertexShader}`.replace('#include <project_vertex>', `
      wsCoarseID = ${TILE_ATTR};
      wsCoarseDelta = (modelMatrix * vec4(transformed, 1.0)).xz
        - (modelMatrix * vec4(wsCoarseCorners[int(${TILE_ATTR})], 1.0)).xz;
      #include <project_vertex>`);
    shader.fragmentShader = `uniform vec4 wsCoarseHidden[${String(SLOTS)}];
varying vec2 wsCoarseDelta;
flat varying float wsCoarseID;
${shader.fragmentShader}`.replace('#include <clipping_planes_fragment>', `
      vec4 mask = wsCoarseHidden[int(wsCoarseID)];
      vec2 halfTile = step(vec2(${(TILE_SIZE / 2).toFixed(1)}), wsCoarseDelta);
      if (mix(mix(mask.x, mask.y, halfTile.x), mix(mask.z, mask.w, halfTile.x), halfTile.y) > 0.5) discard;
      #include <clipping_planes_fragment>`);
  }, { scope: owner, key: prior => `${prior}|df10-coarse-props` });
  const merge = new GroundMerge(parent, material, 'coarse-props.merged', drawn => {
    drawn.receiveShadow = receive; drawn.renderOrder = order;
  }, 'cell');
  const batch = { owner, merge, corners, hidden, used: new Set<number>() };
  const map = batches;
  batches.set(key, batch);
  owner.onDispose(() => { map.delete(key); material.dispose(); });
  return batch;
}

const NONE: ReadonlySet<number> = new Set(), ALL: ReadonlySet<number> = new Set([0, 1, 2, 3]);

/** Preserve clipping at the actual fragment boundary. Only a fully hidden source leaves the merged indices. */
export function mergeCoarseProps(parent: Object3D, scene: Object3D, root: Object3D, meshes: readonly PropMesh[],
  tile: { readonly x: number; readonly z: number }, scope: Scope): (hidden: ReadonlySet<number>) => void {
  const corner = new Vector3(-CHUNK_HALF + tile.x * TILE_SIZE, 0, -CHUNK_HALF + tile.z * TILE_SIZE);
  root.localToWorld(corner);
  // A ring publishes its detached identity group under the cell root. Its prepared world frame is the cell's local frame.
  if (scene.parent !== null) parent.worldToLocal(corner);
  const updates: ((excluded: ReadonlySet<number>) => void)[] = [];
  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    if (!(mesh.material instanceof MeshStandardMaterial) || geometry.hasAttribute(TILE_ATTR)) continue;
    const position = geometry.getAttribute('position'), index = geometry.index;
    if (position === undefined || position.count === 0 || (index !== null && index.array.length < index.count)
      || Object.values(geometry.attributes).some(attribute => attribute instanceof BufferAttribute && attribute.array.length < attribute.count * attribute.itemSize)
      || geometry.drawRange.start !== 0 || geometry.drawRange.count < (index?.count ?? position.count)) continue;
    const batch = group(parent, mesh);
    let id = 0;
    while (batch.used.has(id)) id++;
    if (id === SLOTS) continue;
    batch.used.add(id); corner.toArray(batch.corners, id * 3);
    const data = ownedArray(Uint8Array, position.count, { owner: 'game/coarse-props', asset: 'tile-id', kind: 'geometry-cpu' });
    data.fill(id); geometry.setAttribute(TILE_ATTR, new BufferAttribute(data, 1));
    const mask = batch.merge.add(mesh, scope);
    let full = false;
    updates.push(excluded => {
      for (let q = 0; q < 4; q++) batch.hidden[id * 4 + q] = Number(excluded.has(q));
      const hide = excluded.size === 4;
      if (hide !== full) { full = hide; mask(hide ? ALL : NONE); }
    });
    scope.onDispose(() => {
      geometry.deleteAttribute(TILE_ATTR);
      batch.hidden.fill(0, id * 4, id * 4 + 4);
      batch.used.delete(id);
      if (batch.used.size === 0) batch.owner.dispose();
    });
  }
  return excluded => { for (const update of updates) update(excluded); };
}
