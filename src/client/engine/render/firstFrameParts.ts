import * as THREE from 'three';
import type { RenderItem } from 'three/src/renderers/webgl/WebGLRenderLists.js';
import { gltfOpaqueSort } from './gltfMaterialOrder';

/**
 * LS11 (J204): the orders a slow GPU's first full draws are split along. On SwiftShader the first full view after the
 * world's slices, and the first full shadow map, each held one GPU unit of 1.3-3.3 s that the bar could not cross; drawn
 * first as growing prefixes of the order the renderer meets them in, each prefix a fenced unit, the one-time work lands
 * a part at a time (`Game.firstViewParts`, `Game.fencedDraw`).
 */

const isMaterial = (value: unknown): value is THREE.Material => value instanceof THREE.Material;

/** three's transparent (and transmissive) sort, `reversePainterSortStable` (r186): the engine sets no other. */
function reversePainterSort(a: RenderItem, b: RenderItem): number {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  if (a.z !== b.z) return b.z - a.z;
  return a.id - b.id;
}

/**
 * The shown drawables of `root` from `camera` in the order three's render list draws them (r186 `projectObject`, then
 * `WebGLRenderList.sort` with the engine's `gltfOpaqueSort`): the opaque, then the transmissive and the transparent, far
 * to near. Frustum culling is left out (a part that hides a culled drawable changes nothing); a drawable with several
 * materials takes the place of its first. `opaque` counts the opaque drawables at the front.
 */
export function firstViewOrder(root: THREE.Object3D, camera: THREE.Camera): { order: THREE.Object3D[]; opaque: number } {
  const screen = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), at = new THREE.Vector4();
  const opaque: RenderItem[] = [], transmissive: RenderItem[] = [], transparent: RenderItem[] = [];
  const depth: unknown = Reflect.get(camera, 'reversedDepth'), reversed = depth === true;
  const push = (object: THREE.Object3D, material: THREE.Material, groupOrder: number, z: number): void => {
    const item = { id: object.id, object, geometry: null, material, groupOrder, renderOrder: object.renderOrder, z: reversed ? -z : z,
      group: null, materialVariant: (object instanceof THREE.InstancedMesh ? 2 : 0) + (object instanceof THREE.SkinnedMesh ? 1 : 0) };
    const transmission: unknown = Reflect.get(material, 'transmission');
    (typeof transmission === 'number' && transmission > 0 ? transmissive : material.transparent ? transparent : opaque).push(item);
  };
  const visit = (object: THREE.Object3D, groupOrder: number): void => {
    if (!object.visible) return;
    let order = groupOrder;
    if (object.layers.test(camera.layers)) {
      if (object instanceof THREE.Group) order = object.renderOrder;
      else if (object instanceof THREE.Sprite) {
        if (object.material.visible) push(object, object.material, order, at.setFromMatrixPosition(object.matrixWorld).applyMatrix4(screen).z);
      } else if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
        const sphere: unknown = Reflect.get(object, 'boundingSphere');
        const geometry = object.geometry as THREE.BufferGeometry;
        let center: THREE.Vector3;
        if (sphere !== undefined) {
          if (sphere === null) Reflect.apply(Reflect.get(object, 'computeBoundingSphere') as () => void, object, []);
          center = (Reflect.get(object, 'boundingSphere') as THREE.Sphere).center;
        } else {
          if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
          center = geometry.boundingSphere?.center ?? new THREE.Vector3();
        }
        const z = at.set(center.x, center.y, center.z, 1).applyMatrix4(object.matrixWorld).applyMatrix4(screen).z;
        const material: unknown = object.material;
        if (Array.isArray(material)) {
          for (const group of geometry.groups) {
            const part: unknown = material[group.materialIndex ?? 0];
            if (isMaterial(part) && part.visible) push(object, part, order, z);
          }
        } else if (isMaterial(material) && material.visible) push(object, material, order, z);
      }
    }
    for (const child of object.children) visit(child, order);
  };
  visit(root, 0);
  opaque.sort(gltfOpaqueSort); transmissive.sort(reversePainterSort); transparent.sort(reversePainterSort);
  const seen = new Set<THREE.Object3D>(), order: THREE.Object3D[] = [];
  let opaqueCount = 0;
  for (const [list, isOpaque] of [[opaque, true], [transmissive, false], [transparent, false]] as const) {
    for (const item of list) {
      if (seen.has(item.object)) continue;
      seen.add(item.object); order.push(item.object);
      if (isOpaque) opaqueCount++;
    }
  }
  return { order, opaque: opaqueCount };
}

/** How many of a first-view order part `k` (1-based) draws: `parts.opaque` growing parts of the opaque, then
 *  `parts.transparent` of the rest; the last part draws the whole order. */
export function firstViewCut(k: number, opaque: number, total: number, parts: { readonly opaque: number; readonly transparent: number }): number {
  return k <= parts.opaque ? Math.round(opaque * k / parts.opaque) : opaque + Math.round((total - opaque) * (k - parts.opaque) / parts.transparent);
}

/** The shown shadow casters of `root` in the order the shadow pass meets them (scene order, depth first). */
export function casterOrder(root: THREE.Object3D): THREE.Object3D[] {
  const casters: THREE.Object3D[] = [];
  root.traverseVisible(object => {
    if (object.castShadow && (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) casters.push(object);
  });
  return casters;
}
