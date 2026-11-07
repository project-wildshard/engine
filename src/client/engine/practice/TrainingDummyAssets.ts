import { loadRigFile, bindRig } from '../anim/rig';
import { retainCachedResources } from '../app/cachedAssets';
import { cacheUntilDisposed } from '../app/disposalCache';
/** The three local TRELLIS.2 figures, skinned in Blender and shared by the arena and Model Explorer. */
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  DUMMY_BONE_NAMES, DUMMY_JOINTS, LEGACY_BONE_NAMES,
  type DummyJoints, type DummyRig, type DummyVariant, type TrainingDummyModel,
} from './TrainingDummy';
import { TRAINING_DUMMY_SCALE } from './dummyMetadata';

const URLS: Record<DummyVariant, string> = {
  wood: '/assets/practice/dummies/wood-wood.glb',
  'straw-cloth': '/assets/practice/dummies/straw-cloth.glb',
  'wood-steel': '/assets/practice/dummies/wood-steel.glb',
};
const templates = new Map<DummyVariant, Promise<THREE.Group>>();

function template(variant: DummyVariant): Promise<THREE.Group> {
  let promise = templates.get(variant);
  if (!promise) {
    promise = loadRigFile(URLS[variant]).then((gltf) => retainCachedResources(gltf.scene));
    const pending = promise; void cacheUntilDisposed(pending, () => { if (templates.get(variant) === pending) templates.delete(variant); });
    templates.set(variant, promise);
    void promise.catch(() => { templates.delete(variant); }); // a failed fetch can retry on the next open
  }
  return promise;
}

function bone(root: THREE.Object3D, name: string): THREE.Bone | null {
  const found = root.getObjectByName(name);
  return found instanceof THREE.Bone ? found : null;
}

/**
 * The joints of a loaded figure: the humanoid skeleton when the GLB has its spine (Pelvis, Chest, Head), else the first
 * five-bone export (Torso, Head, LeftArm, RightArm). Throws when neither is there; the caller falls back to the
 * procedural figure.
 */
export function dummyJoints(root: THREE.Object3D): { joints: DummyJoints; rig: DummyRig } {
  const joints: DummyJoints = {};
  if (bone(root, DUMMY_BONE_NAMES.pelvis) && bone(root, DUMMY_BONE_NAMES.chest) && bone(root, DUMMY_BONE_NAMES.head)) {
    for (const joint of DUMMY_JOINTS) {
      const found = bone(root, DUMMY_BONE_NAMES[joint]);
      if (found) joints[joint] = found;
    }
    return { joints, rig: 'humanoid' };
  }
  for (const joint of DUMMY_JOINTS) {
    const name = LEGACY_BONE_NAMES[joint];
    const found = name === undefined ? null : bone(root, name);
    if (found) joints[joint] = found;
  }
  if (!joints.spine || !joints.head || !joints.leftUpperArm || !joints.rightUpperArm) {
    throw new Error('Training dummy GLB has neither the humanoid skeleton (Pelvis, Chest, Head) nor the five-bone one (Torso, Head, LeftArm, RightArm)');
  }
  return { joints, rig: 'five-bone' };
}

export async function loadTrainingDummy(variant: DummyVariant): Promise<TrainingDummyModel> {
  const root = cloneSkeleton(await template(variant)) as THREE.Group;
  root.name = `Training dummy · ${variant}`;
  root.scale.setScalar(TRAINING_DUMMY_SCALE);
  root.traverse((part) => {
    if (!(part instanceof THREE.Mesh)) return;
    part.castShadow = false; part.receiveShadow = false; part.frustumCulled = true;
    if (part.material instanceof THREE.MeshStandardMaterial) {
      // the arena and the turntable light their copies with the studio set (DummyStudio.ts): no emissive here (E289)
      const material = part.material.clone();
      // TRELLIS baked the all-wood figure 0.57 metallic: its brown reflected like tinted brass (yellow-orange in the arena, E285)
      material.metalness = variant === 'wood' ? 0 : Math.min(material.metalness, 0.55);
      part.material = material;
    }
  });
  const result = dummyJoints(root);
  const sockets = result.rig === 'humanoid' ? ['Pelvis', 'Chest', 'Head'] : ['Torso', 'Head', 'LeftArm', 'RightArm'];
  bindRig(root, [], { skeleton: `dummy.${result.rig}`, clips: [], sockets }, { skeleton: `dummy.${result.rig}` });
  return { root, ...result };
}
