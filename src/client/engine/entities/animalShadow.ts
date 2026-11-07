import * as THREE from 'three';
import { SHADOW_LAYER } from '../core/shadowLayer';

/**
 * One shadow draw per animal (PINE-HOLLOW-REMASTER PH-P1 / P2). A PBR rig is one skinned mesh with three material
 * groups (fur / hard / eye, Animal.setDrawLod), and three.js draws a multi-material mesh into the shadow map once per
 * group — 3 depth draws per animal per cascade, the same depth program each time (every group is FrontSide, opaque,
 * no alpha test). The caster is a second SkinnedMesh on the rig's own skeleton and the rig's own vertex / index
 * buffers, without the groups, on SHADOW_LAYER (drawn by the shadow pass only): the same triangles in one draw. The
 * rig itself stops casting; the caster hides / fades / ragdolls with it (a child with an identity transform).
 *
 * Measured with scripts/pine-hollow-drawcalls.mjs: phone cabin pose 41 animal shadow draws → 17, desktop 354 → 118.
 */

const ungroupedOf = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
/** the rig geometry drawn whole: its attributes and index shared (the same GPU buffers), no groups */
function ungrouped(src: THREE.BufferGeometry): THREE.BufferGeometry {
  let g = ungroupedOf.get(src);
  if (g === undefined) {
    g = new THREE.BufferGeometry();
    g.setIndex(src.getIndex());
    for (const [name, attr] of Object.entries(src.attributes)) g.setAttribute(name, attr);
    g.boundingSphere = src.boundingSphere;
    g.boundingBox = src.boundingBox;
    ungroupedOf.set(src, g);
  }
  return g;
}

/** every group draws the same depth: same side, no alpha test, no custom depth / displacement */
function sameDepth(mats: readonly THREE.Material[]): boolean {
  const a = mats[0];
  if (a === undefined) return false;
  return mats.every((m) => m.side === a.side && m.shadowSide === a.shadowSide && m.alphaTest === 0 && m.clippingPlanes === null
    && !('displacementMap' in m && m.displacementMap !== null) && !('alphaMap' in m && m.alphaMap !== null));
}

/**
 * Give a multi-group rig its one-draw shadow caster; returns it (castShadow follows the rig's old flag), or null when
 * the rig already draws in one group or its groups would not shadow alike. `mesh` stops casting.
 */
export function attachShadowCaster(mesh: THREE.SkinnedMesh): THREE.SkinnedMesh | null {
  const mats = mesh.material;
  if (!Array.isArray(mats) || mats.length < 2 || mesh.geometry.groups.length < 2 || !sameDepth(mats)) return null;
  const fur = mats[0];
  if (fur === undefined) return null;
  const caster = new THREE.SkinnedMesh(ungrouped(mesh.geometry), fur);
  caster.name = 'shadow-caster';
  caster.bindMode = mesh.bindMode;
  caster.bind(mesh.skeleton, mesh.bindMatrix);
  caster.boundingSphere = mesh.boundingSphere; // the rig's padded bind-pose sphere (AnimalFactory), same local space
  caster.frustumCulled = mesh.frustumCulled;
  caster.castShadow = mesh.castShadow; caster.receiveShadow = false;
  caster.layers.set(SHADOW_LAYER);
  mesh.add(caster);
  mesh.castShadow = false;
  return caster;
}
