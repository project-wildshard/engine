/** The three shared practice specimens: one humanoid construction, three core/armor materials. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TRAINING_DUMMY_SCALE } from './dummyMetadata';

export type DummyVariant = 'wood' | 'straw-cloth' | 'wood-steel';

/**
 * The bone contract (E285). The humanoid skeleton the Blender rig exports, by exact bone name:
 *   Root (the post, legs bound to it) → Pelvis → Spine → Chest → Neck → Head;
 *   Chest → {Left,Right}Shoulder → …UpperArm → …ForeArm → …Hand;  {Left,Right}Thigh → …Shin.
 * The code drives the joints by these logical names. A GLB missing some of them still animates: the motion folds a
 * missing joint's swing into its neighbour (TrainingArena's DummyMotion). The first GLBs had five bones (Root, Torso,
 * Head, LeftArm, RightArm): Torso drives as the spine, the arms as the upper arms.
 */
export const DUMMY_JOINTS = [
  'root', 'pelvis', 'spine', 'chest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftForeArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightForeArm', 'rightHand',
  'leftThigh', 'leftShin', 'rightThigh', 'rightShin',
] as const;
export type DummyJoint = typeof DUMMY_JOINTS[number];
/** The GLB bone name of each joint in the humanoid skeleton. */
export const DUMMY_BONE_NAMES: Readonly<Record<DummyJoint, string>> = {
  root: 'Root', pelvis: 'Pelvis', spine: 'Spine', chest: 'Chest', neck: 'Neck', head: 'Head',
  leftShoulder: 'LeftShoulder', leftUpperArm: 'LeftUpperArm', leftForeArm: 'LeftForeArm', leftHand: 'LeftHand',
  rightShoulder: 'RightShoulder', rightUpperArm: 'RightUpperArm', rightForeArm: 'RightForeArm', rightHand: 'RightHand',
  leftThigh: 'LeftThigh', leftShin: 'LeftShin', rightThigh: 'RightThigh', rightShin: 'RightShin',
};
/** The first five-bone export (scripts/practice/rig_dummy.py before E285): the bone that stands in for each joint. */
export const LEGACY_BONE_NAMES: Readonly<Partial<Record<DummyJoint, string>>> = {
  root: 'Root', spine: 'Torso', head: 'Head', leftUpperArm: 'LeftArm', rightUpperArm: 'RightArm',
};
export type DummyRig = 'humanoid' | 'five-bone' | 'procedural' | 'placeholder';
export type DummyJoints = Partial<Record<DummyJoint, THREE.Object3D>>;
export interface TrainingDummyModel { root: THREE.Group; joints: DummyJoints; rig: DummyRig }

function mat(color: number, metalness = 0, roughness = 0.82): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness, flatShading: true });
}

function box(parent: THREE.Object3D, material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z); parent.add(mesh);
  return mesh;
}

function cylinder(parent: THREE.Object3D, material: THREE.Material, x: number, y: number, z: number, top: number, bottom: number, height: number, sides = 8): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, sides), material);
  mesh.position.set(x, y, z); parent.add(mesh);
  return mesh;
}

function band(parent: THREE.Object3D, material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number): void {
  const m = box(parent, material, x, y, z, w, h, d);
  m.rotation.z = x < 0 ? -0.12 : 0.12;
}

/** Preserve the five hit-reactive body groups while baking same-material details into a few draws per group. */
function mergeRigid(group: THREE.Group): void {
  const byMaterial = new Map<THREE.Material, THREE.Mesh[]>();
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    const part = child as THREE.Mesh;
    if (Array.isArray(part.material)) continue;
    const list = byMaterial.get(part.material) ?? [];
    list.push(part); byMaterial.set(part.material, list);
  }
  for (const [material, parts] of byMaterial) {
    if (parts.length < 2) continue;
    const baked = parts.map((part) => {
      part.updateMatrix();
      const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
      geometry.applyMatrix4(part.matrix);
      return geometry;
    });
    const joined = mergeGeometries(baked, false) as THREE.BufferGeometry | null;
    baked.forEach((geometry) => { geometry.dispose(); });
    if (!joined) continue;
    for (const part of parts) { group.remove(part); part.geometry.dispose(); }
    group.add(new THREE.Mesh(joined, material));
  }
}

/** Local origin is the foot of the stake. The source geometry is 2.65 m, scaled to player height. */
export function buildTrainingDummy(variant: DummyVariant): TrainingDummyModel {
  const cloth = variant === 'straw-cloth', steel = variant === 'wood-steel';
  const core = mat(cloth ? 0xb99759 : 0x604026);
  const armor = mat(cloth ? 0xd8cbb3 : steel ? 0x54606a : 0x986139, steel ? 0.72 : 0, steel ? 0.31 : 0.82);
  const armorDark = mat(cloth ? 0xaea28e : steel ? 0x2a3641 : 0x6c4129, steel ? 0.62 : 0, steel ? 0.37 : 0.9);
  const trim = mat(cloth ? 0x8d6340 : steel ? 0xa1a9ab : 0xc08d56, steel ? 0.68 : 0.04, 0.42);
  const target = mat(cloth ? 0x9c4e3e : steel ? 0xabcad0 : 0x4e2e20, steel ? 0.32 : 0, 0.7);
  const root = new THREE.Group(); root.name = `Training dummy · ${variant}`;
  root.scale.setScalar(TRAINING_DUMMY_SCALE);

  // The common wooden post and cross foot remain legible behind every armor set, including steel.
  box(root, core, 0, 1.2, -0.16, 0.13, 2.34, 0.13);
  box(root, core, 0, 0.11, -0.13, 0.83, 0.19, 0.19);
  box(root, core, 0, 0.11, -0.13, 0.19, 0.19, 0.75);
  box(root, armorDark, 0, 0.08, 0.2, 0.22, 0.15, 0.12);

  // Human leg spacing and armor make the targets read as standing soldiers, not simple posts.
  for (const side of [-1, 1]) {
    const x = side * 0.23;
    cylinder(root, core, x, 0.68, 0, cloth ? 0.105 : 0.1, 0.09, 0.9);
    band(root, armor, x, 0.77, 0.12, 0.28, 0.46, 0.24);
    band(root, armorDark, x, 0.51, 0.12, 0.24, 0.11, 0.22);
    box(root, armor, x, 0.23, 0.12, 0.27, 0.34, 0.28);
    box(root, armorDark, x, 0.06, 0.2, 0.36, 0.13, 0.47);
  }

  const torso = new THREE.Group(); torso.position.y = 1.42; root.add(torso);
  box(torso, core, 0, 0.04, 0, 0.75, 0.91, 0.39);
  const chest = box(torso, armor, 0, 0.08, 0.23, 0.88, 0.7, 0.22);
  chest.rotation.x = -0.035;
  box(torso, armorDark, 0, -0.31, 0.18, 0.88, 0.15, 0.28);
  for (const side of [-1, 1]) {
    const skirt = box(torso, armor, side * 0.28, -0.52, 0.16, 0.35, 0.32, 0.25);
    skirt.rotation.z = -side * 0.12;
  }
  box(torso, trim, 0, -0.42, 0.32, 0.13, 0.12, 0.07);
  // Concentric scoring rings are raised enough to be read both in the arena and on the turntable.
  for (const [i, r] of [0.23, 0.13, 0.035].entries()) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, i === 2 ? 0.018 : 0.009, 5, 20), target);
    ring.position.set(0, 0.13, 0.35 + i * 0.006); torso.add(ring);
  }

  const head = new THREE.Group(); head.position.y = 0.72; torso.add(head);
  if (cloth) {
    const sack = new THREE.Mesh(new THREE.SphereGeometry(0.31, 9, 7), armor);
    sack.scale.set(0.93, 1.13, 0.84); head.add(sack);
    band(head, trim, 0, -0.24, 0, 0.56, 0.1, 0.45);
  } else {
    cylinder(head, steel ? armor : core, 0, 0.03, 0, 0.27, 0.32, 0.52, 8);
    box(head, armorDark, 0, 0.08, 0.27, 0.37, 0.09, 0.06);
    box(head, trim, 0, -0.15, 0.27, 0.42, 0.035, 0.06);
    if (steel) cylinder(head, trim, 0, 0.31, 0, 0.02, 0.22, 0.11, 8);
  }
  // A target face on cloth and a small visor-like front on the armored heads.
  if (cloth) for (const r of [0.17, 0.095, 0.025]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 5, 16), target);
    ring.position.set(0, 0.03, 0.259); head.add(ring);
  }

  const makeArm = (side: -1 | 1): THREE.Group => {
    const arm = new THREE.Group(); arm.position.set(side * 0.52, 0.34, 0); torso.add(arm);
    cylinder(arm, core, side * 0.11, -0.28, 0, 0.11, 0.1, 0.61);
    const shoulder = cylinder(arm, armor, side * 0.02, -0.03, 0.01, 0.27, 0.17, 0.25, 8);
    shoulder.rotation.z = side * 0.35;
    band(arm, armor, side * 0.15, -0.41, 0.1, 0.26, 0.37, 0.24);
    box(arm, armorDark, side * 0.19, -0.63, 0.04, 0.21, 0.17, 0.22);
    arm.rotation.z = side * 0.09;
    return arm;
  };
  const leftArm = makeArm(-1), rightArm = makeArm(1);
  // The room's floor uses an unlit grid. Casting each armor detail into the shard's distant shadow map costs a
  // second draw per piece without changing the visible practice-room floor.
  for (const rigid of [root, torso, head, leftArm, rightArm]) mergeRigid(rigid);
  return { root, rig: 'procedural', joints: { spine: torso, head, leftUpperArm: leftArm, rightUpperArm: rightArm } };
}
