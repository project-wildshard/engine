/**
 * REMOTE-PLAYERS RP2 (Jake, 2026-11-12: "Jimmy doesn't have a character model"): the castaway's whole body, as another player
 * sees him. First person draws only the castaway's arms (driftwood-fp `fp-arms.glb`): tanned skin, a cream linen shirt with its
 * sleeves rolled to the elbow, bare hands. This is the rest of him in the same colours, read from that GLB's vertex colours and
 * lifted a little for a lit world: hair, face, the shirt, a rope belt, canvas trousers rolled to the shin, bare feet.
 *
 * One skinned, flat-shaded mesh (~1,100 triangles, one draw), built once in code and shared: every body is a skeleton clone of
 * it (`castawayBody()`), the same geometry and material on the GPU. Each part is bound whole to one bone, so a joint turns its
 * part rigidly; the joints overlap so a bent knee or elbow shows no gap.
 *
 * The skeleton is the humanoid contract the practice figure exports (TrainingDummy.ts `DUMMY_BONE_NAMES`, E285), with its
 * axes: every bone's +y runs to its child, so a leg or an arm turned about its own +x swings forward, and the spine leans
 * forward. `OtherBody.pose()` drives it unchanged. Its rest pose is a relaxed stand, arms down and elbows a touch bent: the
 * idle. `rig` is an engine/anim RigInstance on `CASTAWAY_RIG`, whose clip slots are where the motion rows plug in: `idle` is a
 * real clip (a breath and a slow look on the chest and head, which no pose row drives); `walk` and `run` (RP4), `attack` (RP7)
 * and `fly.jump` (RP9, the airborne slot) are declared procedural until those rows fill them. Its sockets `hand.R` and
 * `hand.L` (also `mounts`) hold the held item (RP5): the right grip's +y points forward and down out of the fist, as a relaxed
 * sword hangs; the left is the bow hand.
 *
 *   const body = castawayBody();          // a fresh skeleton on the shared mesh, feet at y 0, facing +z, 1.8 m
 *   body.joints.rightThigh                // a DummyJoints bone, as the practice figure gives it
 *   body.mounts.rightHand.add(sword)      // the held item, its +y along the blade
 *   new AnimMachine({ states: {}, loops: ['idle'] }, body.rig).base('idle')
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { bindRig, type RigBake, type RigContract, type RigInstance } from '../anim/rig';
import { DUMMY_BONE_NAMES, DUMMY_JOINTS, type DummyJoint, type DummyJoints } from '../practice/TrainingDummy';

/** What a proof reads as the model's name. */
export const CASTAWAY_ID = 'castaway';
/** Sole to crown, in metres (the hair's top). */
export const CASTAWAY_HEIGHT = 1.8;
/** The body's animation contract: its motion slots (idle, walk, run, attack, and `fly.jump` for a jump) and its hand sockets. */
export const CASTAWAY_RIG: RigContract = { skeleton: 'castaway-body', clips: ['idle', 'walk', 'run', 'attack', 'fly.jump'], sockets: ['hand.R', 'hand.L'] };
/** Its build: the slots no clip fills yet are posed in code (`OtherBody.pose()`), the sockets are the hand mounts. */
const CASTAWAY_BAKE: RigBake = {
  skeleton: 'castaway-body', procedural: ['walk', 'run', 'attack', 'fly.jump'], sockets: { 'hand.R': 'RightHandMount', 'hand.L': 'LeftHandMount' },
  joints: [DUMMY_JOINTS.map(joint => DUMMY_BONE_NAMES[joint])],
};

/** One body: its root (feet at 0, facing +z), the contract's joints, the held-item mounts and its rig. */
export interface CastawayBody {
  readonly id: typeof CASTAWAY_ID;
  readonly root: THREE.Group;
  readonly joints: DummyJoints;
  readonly mounts: { readonly rightHand: THREE.Object3D; readonly leftHand: THREE.Object3D };
  readonly rig: RigInstance;
}

/** The castaway's colours (sRGB): the fp arms' skin #b47149 and linen #e9dfc9, a step brighter for a lit world. */
const SKIN = 0xc27f55, SKIN_DARK = 0xa86a44, LINEN = 0xe6dcc4, LINEN_SHADE = 0xcfc3a5, CANVAS = 0x6e6a52, CANVAS_CUFF = 0x878064;
const ROPE = 0xa78656, HAIR = 0x3a2a1d, STUBBLE = 0x7a5238, EYE = 0x1d1712, LIP = 0x9a5a40;

/** Each bone: its parent, its head and where it points (its tail), in metres over the feet. Left is +x (the figure faces +z). */
interface BoneSpec { readonly parent: DummyJoint | null; readonly head: readonly [number, number, number]; readonly tail: readonly [number, number, number] }
const side = (joint: string): 1 | -1 => (joint.startsWith('left') ? 1 : -1);
function boneSpecs(): Record<DummyJoint, BoneSpec> {
  const specs: Partial<Record<DummyJoint, BoneSpec>> = {
    root: { parent: null, head: [0, 0, 0], tail: [0, 0.2, 0] },
    pelvis: { parent: 'root', head: [0, 0.95, 0], tail: [0, 1.05, 0] },
    spine: { parent: 'pelvis', head: [0, 1.05, 0], tail: [0, 1.22, 0] },
    chest: { parent: 'spine', head: [0, 1.22, 0], tail: [0, 1.47, 0] },
    neck: { parent: 'chest', head: [0, 1.47, 0], tail: [0, 1.56, 0] },
    head: { parent: 'neck', head: [0, 1.56, 0], tail: [0, 1.8, 0] },
  };
  for (const s of ['left', 'right'] as const) {
    const x = s === 'left' ? 1 : -1;
    specs[`${s}Shoulder`] = { parent: 'chest', head: [0.05 * x, 1.42, 0], tail: [0.19 * x, 1.42, 0] };
    specs[`${s}UpperArm`] = { parent: `${s}Shoulder`, head: [0.19 * x, 1.42, 0], tail: [0.225 * x, 1.13, -0.005] };
    specs[`${s}ForeArm`] = { parent: `${s}UpperArm`, head: [0.225 * x, 1.13, -0.005], tail: [0.24 * x, 0.885, 0.04] };
    specs[`${s}Hand`] = { parent: `${s}ForeArm`, head: [0.24 * x, 0.885, 0.04], tail: [0.245 * x, 0.71, 0.05] };
    specs[`${s}Thigh`] = { parent: 'root', head: [0.1 * x, 0.93, 0], tail: [0.1 * x, 0.5, 0.01] };
    specs[`${s}Shin`] = { parent: `${s}Thigh`, head: [0.1 * x, 0.5, 0.01], tail: [0.1 * x, 0.08, -0.01] };
  }
  return specs as Record<DummyJoint, BoneSpec>;
}

const Y = new THREE.Vector3(0, 1, 0);
const vec = (p: readonly [number, number, number]): THREE.Vector3 => new THREE.Vector3(p[0], p[1], p[2]);

/** A part's geometry, coloured flat, in the bind pose's world space. */
function coloured(geometry: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const flat = geometry.index === null ? geometry : geometry.toNonIndexed();
  flat.deleteAttribute('uv');
  const c = new THREE.Color(color).convertSRGBToLinear(), count = flat.getAttribute('position').count, colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return flat;
}
/** A tapered tube between two points, `r0` at `from`, `r1` at `to`, squashed to `depth` front to back. */
function tube(from: readonly [number, number, number], to: readonly [number, number, number], r0: number, r1: number, color: number, depth = 1, sides = 7): THREE.BufferGeometry {
  const a = vec(from), b = vec(to), length = a.distanceTo(b), g = new THREE.CylinderGeometry(r1, r0, length, sides, 1, false);
  g.scale(1, 1, depth);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, b.clone().sub(a).normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return coloured(g, color);
}
function block(at: readonly [number, number, number], size: readonly [number, number, number], color: number, tilt = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
  if (tilt !== 0) g.rotateX(tilt);
  g.translate(at[0], at[1], at[2]);
  return coloured(g, color);
}
function blob(at: readonly [number, number, number], radii: readonly [number, number, number], color: number, detail = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  g.scale(radii[0], radii[1], radii[2]); g.translate(at[0], at[1], at[2]);
  return coloured(g, color);
}

/** Every part, by the bone that carries it. */
function parts(): Partial<Record<DummyJoint, THREE.BufferGeometry[]>> {
  const out: Partial<Record<DummyJoint, THREE.BufferGeometry[]>> = {
    pelvis: [
      tube([0, 0.86, 0], [0, 1.03, 0], 0.17, 0.165, CANVAS, 0.66, 8),
      tube([0, 1.0, 0], [0, 1.045, 0], 0.172, 0.17, ROPE, 0.68, 8),
      block([0.07, 1.0, 0.115], [0.035, 0.09, 0.02], ROPE, 0.2),
    ],
    spine: [tube([0, 1.03, 0], [0, 1.25, 0], 0.165, 0.18, LINEN, 0.64, 8)],
    chest: [
      tube([0, 1.22, 0], [0, 1.46, 0], 0.18, 0.205, LINEN, 0.6, 8),
      blob([0.17, 1.42, 0], [0.075, 0.065, 0.075], LINEN), blob([-0.17, 1.42, 0], [0.075, 0.065, 0.075], LINEN),
      // the open collar: a V of skin, and its two flaps
      block([0, 1.41, 0.118], [0.075, 0.1, 0.012], SKIN, -0.08),
      block([0.05, 1.43, 0.12], [0.05, 0.07, 0.014], LINEN_SHADE, -0.1), block([-0.05, 1.43, 0.12], [0.05, 0.07, 0.014], LINEN_SHADE, -0.1),
    ],
    neck: [tube([0, 1.45, 0.005], [0, 1.58, 0.01], 0.055, 0.05, SKIN, 1, 7)],
    head: [
      blob([0, 1.665, 0.01], [0.098, 0.12, 0.108], SKIN, 2),
      // hair: a cap over the crown and the back, the face left clear
      blob([0, 1.71, -0.012], [0.106, 0.09, 0.112], HAIR, 1), blob([0, 1.66, -0.045], [0.1, 0.08, 0.075], HAIR, 1),
      // stubble on the jaw and chin, a nose, eyes, a mouth, ears
      blob([0, 1.6, 0.045], [0.085, 0.05, 0.07], STUBBLE, 1),
      block([0, 1.66, 0.112], [0.026, 0.045, 0.03], SKIN_DARK, 0.25),
      block([0.035, 1.685, 0.1], [0.022, 0.014, 0.012], EYE), block([-0.035, 1.685, 0.1], [0.022, 0.014, 0.012], EYE),
      block([0.035, 1.705, 0.102], [0.032, 0.009, 0.012], HAIR), block([-0.035, 1.705, 0.102], [0.032, 0.009, 0.012], HAIR),
      block([0, 1.618, 0.106], [0.04, 0.01, 0.012], LIP),
      blob([0.098, 1.665, 0], [0.018, 0.03, 0.02], SKIN_DARK, 0), blob([-0.098, 1.665, 0], [0.018, 0.03, 0.02], SKIN_DARK, 0),
    ],
  };
  for (const s of ['left', 'right'] as const) {
    const x = side(s);
    // rolled linen sleeve to just over the elbow, then bare forearm, then the hand
    out[`${s}UpperArm`] = [
      tube([0.19 * x, 1.44, 0], [0.214 * x, 1.21, -0.003], 0.068, 0.06, LINEN, 1, 7),
      tube([0.213 * x, 1.23, -0.003], [0.217 * x, 1.19, -0.004], 0.066, 0.066, LINEN_SHADE, 1, 7),
      tube([0.216 * x, 1.2, -0.004], [0.226 * x, 1.12, -0.005], 0.05, 0.046, SKIN, 1, 6),
    ];
    out[`${s}ForeArm`] = [tube([0.225 * x, 1.14, -0.005], [0.24 * x, 0.89, 0.04], 0.047, 0.036, SKIN, 1, 6)];
    out[`${s}Hand`] = [
      block([0.243 * x, 0.83, 0.045], [0.04, 0.1, 0.085], SKIN), // palm
      block([0.245 * x, 0.765, 0.05], [0.036, 0.05, 0.075], SKIN_DARK), // curled fingers
      block([0.235 * x, 0.84, 0.095], [0.026, 0.06, 0.03], SKIN), // thumb
    ];
    // canvas trousers, rolled at the shin, bare calf and a bare foot
    out[`${s}Thigh`] = [tube([0.1 * x, 0.96, 0], [0.1 * x, 0.49, 0.01], 0.095, 0.072, CANVAS, 1, 8)];
    out[`${s}Shin`] = [
      tube([0.1 * x, 0.52, 0.01], [0.1 * x, 0.38, 0.002], 0.072, 0.07, CANVAS, 1, 8),
      tube([0.1 * x, 0.4, 0.002], [0.1 * x, 0.345, 0], 0.08, 0.08, CANVAS_CUFF, 1, 8),
      tube([0.1 * x, 0.36, 0], [0.1 * x, 0.075, -0.012], 0.054, 0.04, SKIN, 0.95, 7),
      block([0.1 * x, 0.035, 0.035], [0.095, 0.07, 0.235], SKIN, 0), // the foot, its sole on y 0
      block([0.1 * x, 0.025, 0.155], [0.09, 0.05, 0.03], SKIN_DARK), // toes
    ];
  }
  return out;
}

/** The idle slot: a breath on the chest every 3 s and a slow look left and right, over 6 s, from the rest pose. */
function idleClip(rest: ReadonlyMap<string, THREE.Quaternion>): THREE.AnimationClip {
  const times = [0, 1.5, 3, 4.5, 6], about = (name: string, axis: THREE.Vector3, angles: readonly number[]): THREE.QuaternionKeyframeTrack => {
    const base = rest.get(name) ?? new THREE.Quaternion(), values: number[] = [];
    for (const angle of angles) values.push(...base.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle)).toArray());
    return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values);
  };
  return new THREE.AnimationClip('idle', 6, [
    about('Chest', new THREE.Vector3(1, 0, 0), [0, -0.03, 0, -0.03, 0]),
    about('Head', new THREE.Vector3(0, 1, 0), [0, 0.12, 0.05, -0.1, 0]),
  ]);
}

interface Template { readonly root: THREE.Group; readonly idle: THREE.AnimationClip }
let template: Template | null = null, failed: Error | null = null;

/** The one shared build: the skeleton in its rest pose, the skinned mesh bound to it, the grips and the idle clip. */
function build(): Template {
  const specs = boneSpecs(), bones = new Map<DummyJoint, THREE.Bone>(), world = new Map<DummyJoint, THREE.Matrix4>();
  const root = new THREE.Group(); root.name = 'Castaway';
  for (const joint of DUMMY_JOINTS) {
    const spec = specs[joint], bone = new THREE.Bone(); bone.name = DUMMY_BONE_NAMES[joint];
    const head = vec(spec.head), aim = vec(spec.tail).sub(head).normalize();
    // +y along the bone and +z kept forward, so it turned about the world's z, as the practice rig's are: a bone that hangs
    // (a leg, an arm) has its +x to the world's -x, and turning it by +a swings it forward; an upright one keeps the world's axes
    const front = new THREE.Vector3(0, 0, 1).addScaledVector(aim, -aim.z).normalize(), across = new THREE.Vector3().crossVectors(aim, front);
    const turned = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, aim, front)), matrix = new THREE.Matrix4().compose(head, turned, new THREE.Vector3(1, 1, 1));
    const parent = spec.parent === null ? null : bones.get(spec.parent), parentWorld = spec.parent === null ? null : world.get(spec.parent);
    const local = parentWorld === null || parentWorld === undefined ? matrix.clone() : parentWorld.clone().invert().multiply(matrix);
    local.decompose(bone.position, bone.quaternion, bone.scale);
    (parent ?? root).add(bone); bones.set(joint, bone); world.set(joint, matrix);
  }
  root.updateMatrixWorld(true);
  const order = DUMMY_JOINTS.map(joint => bones.get(joint) as THREE.Bone), pieces: THREE.BufferGeometry[] = [];
  for (const [joint, geometries] of Object.entries(parts()) as [DummyJoint, THREE.BufferGeometry[]][]) {
    const index = DUMMY_JOINTS.indexOf(joint);
    for (const geometry of geometries) {
      const count = geometry.getAttribute('position').count, skinIndex = new Uint16Array(count * 4), skinWeight = new Float32Array(count * 4);
      for (let v = 0; v < count; v++) { skinIndex[v * 4] = index; skinWeight[v * 4] = 1; }
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
      pieces.push(geometry);
    }
  }
  const geometry = mergeGeometries(pieces);
  if (geometry === null) throw new Error('castaway body: parts did not merge');
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.86, metalness: 0 });
  material.userData['shared'] = true; geometry.userData['shared'] = true;
  const mesh = new THREE.SkinnedMesh(geometry, material); mesh.name = 'CastawayBody';
  root.add(mesh); mesh.bind(new THREE.Skeleton(order), new THREE.Matrix4());
  // The grips: the right hand's +y forward and down out of the fist, the left's the same, for the bow.
  for (const s of ['right', 'left'] as const) {
    const hand = bones.get(`${s}Hand`) as THREE.Bone, mount = new THREE.Object3D(); mount.name = s === 'right' ? 'RightHandMount' : 'LeftHandMount';
    const grip = new THREE.Matrix4().compose(new THREE.Vector3(0.243 * side(s), 0.8, 0.06), new THREE.Quaternion().setFromUnitVectors(Y, new THREE.Vector3(0, -0.5, 0.866)), new THREE.Vector3(1, 1, 1));
    hand.matrixWorld.clone().invert().multiply(grip).decompose(mount.position, mount.quaternion, mount.scale);
    hand.add(mount);
  }
  const rest = new Map(order.map(bone => [bone.name, bone.quaternion.clone()]));
  return { root, idle: idleClip(rest) };
}

/** A body: a skeleton clone of the one shared build (its mesh's geometry and material are shared, never disposed per body). */
export function castawayBody(): CastawayBody {
  if (failed !== null) throw failed;
  try { template ??= build(); } catch (error) { failed = error instanceof Error ? error : new Error(String(error)); throw failed; }
  const root = cloneSkeleton(template.root) as THREE.Group, joints: DummyJoints = {};
  for (const joint of DUMMY_JOINTS) { const bone = root.getObjectByName(DUMMY_BONE_NAMES[joint]); if (bone !== undefined) joints[joint] = bone; }
  const rig = bindRig(root, [template.idle], CASTAWAY_RIG, CASTAWAY_BAKE), rightHand = rig.sockets.get('hand.R'), leftHand = rig.sockets.get('hand.L');
  if (rightHand === undefined || leftHand === undefined) throw new Error('castaway body: a hand mount is missing');
  return { id: CASTAWAY_ID, root, joints, mounts: { rightHand, leftHand }, rig };
}

/** A soft dark disc under a body's feet, its ground contact: dark at the middle, gone at the rim. Shared by every body. */
let contactGeometry: THREE.BufferGeometry | null = null, contactMaterial: THREE.MeshBasicMaterial | null = null;
export function groundContact(): THREE.Mesh {
  if (contactGeometry === null || contactMaterial === null) {
    const rim = 20, positions = [0, 0, 0], colors = [0, 0, 0, 0.42], index: number[] = [];
    for (let i = 0; i < rim; i++) { const a = (i / rim) * Math.PI * 2; positions.push(Math.cos(a) * 0.24, 0, Math.sin(a) * 0.2, Math.cos(a) * 0.4, 0, Math.sin(a) * 0.34); colors.push(0, 0, 0, 0.3, 0, 0, 0, 0); }
    for (let i = 0; i < rim; i++) { const inner = 1 + i * 2, outer = inner + 1, nextInner = 1 + ((i + 1) % rim) * 2, nextOuter = nextInner + 1; index.push(0, nextInner, inner, inner, nextInner, outer, outer, nextInner, nextOuter); }
    contactGeometry = new THREE.BufferGeometry();
    contactGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); contactGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4)); contactGeometry.setIndex(index);
    contactGeometry.userData['shared'] = true;
    contactMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    contactMaterial.userData['shared'] = true;
  }
  const disc = new THREE.Mesh(contactGeometry, contactMaterial); disc.name = 'GroundContact'; disc.position.y = 0.02; disc.renderOrder = 1;
  return disc;
}
